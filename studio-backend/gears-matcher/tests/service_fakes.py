"""A runner that makes no model call, for testing the service itself (not the matching).

It follows the conventions the contract tests rely on, so the same tests can run against any
implementation of the service:

- a run walks the 8 requirements of the todo-app report, one `step` each, two calls per requirement;
- `options.max_calls` under 20 stops it halfway (`partial`, with the rest not assessed);
- product `boom` ends the run `failed`; product `crash` raises (a bug);
- product `freeform` is a stand-in for a spec not in the format: refused without
  `options.extract_max_calls`;
- cancel counts one call as already in flight, as the contract says it may be billed.
"""

import json
import socket
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI

from gears_matcher.service.errors import unprocessable
from gears_matcher.service.request import RunRequest
from gears_matcher.service.runner import Cancelled, Meter, Outcome, RunFailed

REPORT = Path(__file__).parent / "fixtures/golden/todo-app.report.json"
POLL = 0.01


class FakeRunner:
    def __init__(self, step: float = 0.02) -> None:
        self.step = step
        self.report = json.loads(REPORT.read_text(encoding="utf-8"))
        self.total = len(self.report["requirements"])
        self.preflights: list[str] = []

    def preflight(self, request: RunRequest) -> None:
        self.preflights.append(request.product)
        if request.product == "freeform" and request.extract_max_calls is None:
            raise unprocessable("not_a_template", "not in the spec format; set extract_max_calls")

    def _wait(self, meter: Meter) -> bool:
        """Sleep one step; False if the caller asked to stop meanwhile."""
        end = time.monotonic() + self.step
        while time.monotonic() < end:
            if meter.cancelled():
                return False
            time.sleep(min(POLL, self.step))
        return not meter.cancelled()

    def run(self, request: RunRequest, meter: Meter) -> Outcome:
        cut = self.total if request.max_calls >= 20 else max(1, self.total // 2)
        calls = 0
        for done in range(cut):
            if not self._wait(meter):
                meter.usage(calls + 1, 0, (calls + 1) * 900, (calls + 1) * 120)
                raise Cancelled
            calls += 2
            meter.progress(done + 1, self.total)
            meter.usage(calls, 0, calls * 900, calls * 120)
        if request.product == "boom":
            raise RunFailed("internal", "boom")
        if request.product == "crash":
            raise RuntimeError("secret document text must never reach a caller")
        return Outcome(json.dumps(self.report), self.total, self.total - cut)

    def info(self) -> dict[str, Any]:
        return {
            "service_version": "0.0.0-test",
            "matcher_version": "fake",
            "report_schema_versions": [self.report["schema_version"]],
            "catalogue": {"source": "gears-rust", "gears_md_commit": "x", "gear_gdl_commit": "x"},
            "models": ["fake"],
        }


@contextmanager
def serve_app(app: FastAPI) -> Iterator[str]:
    """Run an app on a free local port, as in production (uvicorn); yield its base address."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = int(sock.getsockname()[1])
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="critical"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    assert server.started, "the service did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def get(url: str, secret: str | None = None) -> tuple[int, Any]:
    """One GET, with the status and the decoded body, also for an error status."""
    headers = {"Authorization": f"Bearer {secret}"} if secret else {}
    req = urllib.request.Request(url, headers=headers)  # noqa: S310 -- a local test server
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 -- a local test server
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read())
