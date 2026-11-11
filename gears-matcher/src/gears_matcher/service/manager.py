"""Submit a run, run it in the background, cancel it, and run it again after a restart.

One lock keeps submit and cancel from racing each other. Runs themselves execute on a small pool
of worker threads, each calling `Runner.run`, which is slow and paid, so nothing here holds the lock
while a run is going.
"""

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

from gears_matcher.service.errors import ProblemError, not_found
from gears_matcher.service.request import Limits, RunRequest, parse_request
from gears_matcher.service.runner import Cancelled, Outcome, RunFailed, Runner
from gears_matcher.service.store import TERMINAL, Row, RunStore

log = logging.getLogger("gears_matcher.service")
_RETRY_AFTER = "5"


def _iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class _Meter:
    """What a running run is given: the cancel flag, and a way to record progress and usage."""

    def __init__(self, store: RunStore, run_id: str, stop: threading.Event) -> None:
        self.store, self.run_id, self.stop = store, run_id, stop

    def cancelled(self) -> bool:
        return self.stop.is_set()

    def progress(self, done: int, total: int) -> None:
        self.store.update(
            self.run_id, progress={"requirements_total": total, "requirements_done": done}
        )

    def usage(self, calls: int, cache_hits: int, input_tokens: int, output_tokens: int) -> None:
        self.store.update(
            self.run_id,
            usage={
                "calls": calls,
                "cache_hits": cache_hits,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            },
        )


class RunManager:
    def __init__(
        self,
        store: RunStore,
        runner: Runner,
        limits: Limits,
        workers: int = 4,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.store, self.runner, self.limits, self.clock = store, runner, limits, clock
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="run")
        self._stops: dict[str, threading.Event] = {}

    # --- what a caller sees

    def view(self, row: Row) -> dict[str, Any]:
        """The contract's `Run`."""
        state = row["state"]
        out: dict[str, Any] = {
            "id": row["id"],
            "state": state,
            "created_at": _iso(row["created_at"]),
            "started_at": _iso(row["started_at"]),
            "finished_at": _iso(row["finished_at"]),
            "usage": row["usage"],
        }
        if state in ("running", "cancelling") and row["progress"]:
            out["progress"] = row["progress"]
        if row["outcome"]:
            out["outcome"] = row["outcome"]
        if row["error"]:
            out["error"] = row["error"]
        return out

    def get(self, run_id: str) -> dict[str, Any]:
        return self.view(self._row(run_id))

    def report(self, run_id: str) -> str:
        row = self._row(run_id)
        if row["state"] not in ("succeeded", "partial") or row["report"] is None:
            raise ProblemError(
                HTTPStatus.CONFLICT, "no_report", f"the run is {row['state']}: there is no report"
            )
        report: str = row["report"]
        return report

    def _row(self, run_id: str) -> Row:
        row = self.store.get(run_id)
        if row is None:
            raise not_found()
        return row

    # --- submit and cancel

    def submit(self, key: str, digest: str, body: Any) -> dict[str, Any]:
        """A new run, or the existing one for this key and body. Raises `ProblemError`."""
        with self._lock:
            existing = self.store.by_key(key)
            if existing is not None:
                if existing["body_digest"] != digest:
                    raise ProblemError(
                        HTTPStatus.CONFLICT,
                        "idempotency_conflict",
                        "this key was used with another body",
                    )
                return self.view(existing)
            request = parse_request(body, self.limits)
            self.runner.preflight(request)
            cap = self.limits.max_concurrent_runs
            if cap is not None and self.store.active_count() >= cap:
                raise ProblemError(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    "busy",
                    "too many runs at once",
                    {"Retry-After": _RETRY_AFTER},
                )
            run_id = uuid.uuid4().hex[:12]
            self.store.create(run_id, key, digest, request.to_json(), self.clock())
            accepted = self.get(run_id)  # before a worker can pick it up: it is `queued`
            self._enqueue(run_id)
            return accepted

    def cancel(self, run_id: str) -> tuple[dict[str, Any], bool]:
        """Ask a run to stop. The flag is True if it is still in progress (answer 202), False if it
        had already ended (answer 200, nothing changed)."""
        with self._lock:
            row = self._row(run_id)
            if row["state"] in TERMINAL:
                return self.view(row), False
            if row["state"] == "queued" and self.store.set_state(run_id, "cancelled", ("queued",)):
                self.store.update(run_id, finished_at=self.clock(), request=None)
                return self.get(run_id), True
            stop = self._stops.get(run_id)
            if stop is not None:
                stop.set()
            self.store.set_state(run_id, "cancelling", ("running", "queued"))
            return self.get(run_id), True

    # --- running

    def recover(self) -> int:
        """After a restart: run again what was interrupted (its model replies are cached)."""
        again = 0
        with self._lock:
            for row in self.store.unfinished():
                if row["state"] == "cancelling":
                    self._finish(row["id"], "cancelled")
                    continue
                self.store.update(row["id"], state="queued", progress=None)
                self._enqueue(row["id"])
                again += 1
        return again

    def ready(self) -> None:
        """Raises if the store cannot be read or the runner cannot do its work."""
        self.store.ping()
        self.runner.ready()

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _enqueue(self, run_id: str) -> None:
        self._stops[run_id] = threading.Event()
        self._pool.submit(self._execute, run_id)

    def _execute(self, run_id: str) -> None:
        stop = self._stops.get(run_id)
        try:
            row = self.store.get(run_id)
            if (
                stop is None
                or row is None
                or not self.store.set_state(run_id, "running", ("queued",))
            ):
                return  # cancelled while it waited, or gone
            self.store.update(run_id, started_at=self.clock())
            request = RunRequest.from_json(row["request"])
            self._conclude(run_id, request, stop)
        finally:
            self._stops.pop(run_id, None)

    def _conclude(self, run_id: str, request: RunRequest, stop: threading.Event) -> None:
        try:
            outcome = self.runner.run(request, _Meter(self.store, run_id, stop))
        except Cancelled:
            self._finish(run_id, "cancelled")
        except RunFailed as exc:
            self._finish(run_id, "failed", error={"kind": exc.kind, "message": exc.message})
        except Exception:
            log.exception("run %s failed with a bug", run_id)  # the traceback stays in the log
            message = "an unexpected error; no report was made"
            self._finish(run_id, "failed", error={"kind": "internal", "message": message})
        else:
            self._succeeded(run_id, outcome)

    def _succeeded(self, run_id: str, outcome: Outcome) -> None:
        state = "partial" if outcome.not_assessed > 0 else "succeeded"
        self._finish(
            run_id,
            state,
            report=outcome.report_json,
            outcome={
                "requirements": outcome.requirements,
                "not_assessed": outcome.not_assessed,
                "report_url": f"/v1/runs/{run_id}/report",
            },
        )

    def _finish(self, run_id: str, state: str, **columns: Any) -> None:
        """End a run: its state, and the request's document text is dropped."""
        self.store.update(
            run_id, state=state, finished_at=self.clock(), request=None, progress=None, **columns
        )
