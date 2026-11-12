"""The LLM access key through the whole service (HYP-3176): read from the environment only, sent in
the one header the connector wants, and never found in anything the service keeps or says.

The real `ConstructorClient` and the real runner, run through the run manager and the run store, on
a gateway that is a function (`httpx2.MockTransport`): no network. After a run, with the gateway
answering and with it failing and echoing the key back, the key is looked for in what a caller can
read (the run, the report, `info`), in the run store file, in the reply cache, and in the log.
"""

import json
import logging
import socket
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx2
import pytest
from test_run import FakeModel, coded
from test_service_runner import PRD, doc

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.judge.llm import constructor_client as cc
from gears_matcher.judge.llm.constructor_client import ConstructorClient
from gears_matcher.judge.llm.run import RunError
from gears_matcher.service.__main__ import model_factory
from gears_matcher.service.manager import RunManager
from gears_matcher.service.request import Limits, body_digest
from gears_matcher.service.runner import RealRunner
from gears_matcher.service.store import RunStore

KEY = "not-a-real-key-SENTINEL-for-the-service"  # a sentinel, not a credential
SETTINGS = {
    "LLM_CONNECTORS_ACCESS_KEY": KEY,
    "CONSTRUCTOR_STAND": "gateway.example.test",
    "CONSTRUCTOR_CMODEL_ID": "11111111-aaaa-bbbb-cccc-222222222222",
    "CONSTRUCTOR_PUBLIC_CONNECTOR_ID": "33333333-dddd-eeee-ffff-444444444444",
}
TERMINAL = {"succeeded", "partial", "failed", "cancelled"}


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CI", raising=False)  # the matcher refuses a catalogue model when CI is set
    for name in cc.SETTING_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    for name, value in SETTINGS.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(f"{cc.__name__}.time.sleep", lambda seconds: None)  # no retry pauses

    def refuse(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)


def gateway_answering(model: FakeModel, seen: list[httpx2.Request]) -> Callable[..., Any]:
    """A gateway whose replies are the fake model's, in the chat-completion shape."""

    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        messages = json.loads(request.content)["messages"]
        system = messages[0]["content"].rsplit("\n\n" + cc.FORMAT_INSTRUCTION, 1)[0]
        out = model.complete(system=system, user=messages[1]["content"], schema={}, timeout_s=0)
        reply = {"choices": [{"message": {"content": out.text}, "finish_reason": "stop"}]}
        return httpx2.Response(200, json=reply | {"usage": {"prompt_tokens": 1}})

    return handle


def gateway_failing(seen: list[httpx2.Request]) -> Callable[..., Any]:
    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(401, text=f"bad access key {KEY}")

    return handle


def run_through_the_service(
    catalogue: Catalogue, tmp_path: Path, pg_url: str, handler: Callable[..., Any]
) -> tuple[dict[str, Any], RunManager, RealRunner]:
    http = httpx2.Client(transport=httpx2.MockTransport(handler))
    runner = RealRunner(
        catalogue,
        lambda name: (cc.label(name), ConstructorClient(model=name, http=http)),
        tmp_path / "data" / "cache",
        tmp_path / "data" / "work",
    )
    limits = Limits(max_concurrent_runs=2)
    manager = RunManager(RunStore(pg_url), runner, limits, workers=2)
    body = {
        "product": "todo-app",
        "documents": [doc("specs/PRD.md", PRD).__dict__],
        "options": {"max_calls": 100},
    }
    run = manager.submit("run-1", body_digest(body), body)
    deadline = time.monotonic() + 60
    while manager.get(run["id"])["state"] not in TERMINAL:
        assert time.monotonic() < deadline, "the run did not end"
        time.sleep(0.02)
    manager.shutdown()
    return manager.get(run["id"]), manager, runner


def everything_the_service_keeps_or_says(
    final: dict[str, Any], manager: RunManager, runner: RealRunner, tmp_path: Path, log: str
) -> dict[str, bytes | str]:
    store = manager.store
    found: dict[str, bytes | str] = {
        "the run": json.dumps(final),
        "info": json.dumps(runner.info()),
        "the log": log,
    }
    if final["state"] in ("succeeded", "partial"):
        found["the report"] = manager.report(final["id"])
    for path in sorted((tmp_path / "data").rglob("*")):
        if path.is_file():
            found[f"the file {path.relative_to(tmp_path)}"] = path.read_bytes()
    with store.pool.connection() as db:
        rows = db.execute("SELECT * FROM runs").fetchall()
    found["the run store"] = json.dumps(rows, default=str)
    return found


def assert_no_key(found: dict[str, bytes | str]) -> None:
    for where, content in found.items():
        data = content if isinstance(content, bytes) else content.encode()
        assert KEY.encode() not in data, f"the access key is in {where}"


def test_a_run_uses_the_key_in_the_header_and_keeps_it_nowhere(
    fixture_catalogue: Catalogue, tmp_path: Path, pg_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    seen: list[httpx2.Request] = []
    model = FakeModel(coded(fixture_catalogue))
    with caplog.at_level(logging.DEBUG):
        final, manager, runner = run_through_the_service(
            fixture_catalogue, tmp_path, pg_url, gateway_answering(model, seen)
        )
    assert final["state"] in ("succeeded", "partial")
    assert seen, "the gateway was called"
    assert all(r.headers["x-model-accesskey"] == KEY for r in seen)
    kept = everything_the_service_keeps_or_says(final, manager, runner, tmp_path, caplog.text)
    assert any(name.startswith("the file data/cache") for name in kept), "the cache was written"
    assert '"state"' in str(kept["the run store"]), "the run store was read"
    assert_no_key(kept)


def test_a_gateway_that_echoes_the_key_in_an_error_leaves_it_nowhere(
    fixture_catalogue: Catalogue, tmp_path: Path, pg_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    seen: list[httpx2.Request] = []
    with caplog.at_level(logging.DEBUG):
        final, manager, runner = run_through_the_service(
            fixture_catalogue, tmp_path, pg_url, gateway_failing(seen)
        )
    assert seen, "the gateway was called"
    assert final["state"] != "succeeded"
    assert_no_key(
        everything_the_service_keeps_or_says(final, manager, runner, tmp_path, caplog.text)
    )


def test_the_service_will_not_start_without_the_key_and_names_only_the_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LLM_CONNECTORS_ACCESS_KEY")
    with pytest.raises(RunError) as caught:
        model_factory()
    assert "LLM_CONNECTORS_ACCESS_KEY" in str(caught.value)
    assert KEY not in str(caught.value)
