"""The service's own behaviour that the contract does not state: what is kept, what survives a
restart, what a caller never sees. On the fake runner and a real SQLite file; no model is called."""

import sqlite3
import time
from pathlib import Path
from typing import Any

import pytest
from service_fakes import FakeRunner, get, serve_app

from gears_matcher.service.app import create_app
from gears_matcher.service.manager import RunManager
from gears_matcher.service.request import Limits, RunRequest, body_digest, parse_request
from gears_matcher.service.store import TERMINAL, RunStore

DOC = "# Todo\n"


def body(product: str = "todo-app", **options: Any) -> dict[str, Any]:
    import hashlib  # noqa: PLC0415 -- only here

    sha = hashlib.sha256(DOC.encode()).hexdigest()
    out: dict[str, Any] = {
        "product": product,
        "documents": [{"path": "specs/prd.md", "sha256": sha, "content": DOC}],
    }
    if options:
        out["options"] = options
    return out


def manager(tmp_path: Path, step: float = 0.01, **limits: Any) -> tuple[RunManager, RunStore]:
    store = RunStore(tmp_path / "runs.sqlite")
    return RunManager(store, FakeRunner(step), Limits(**limits)), store


def submit(m: RunManager, key: str, **kw: Any) -> dict[str, Any]:
    payload = body(**kw)
    return m.submit(key, body_digest(payload), payload)


def wait(m: RunManager, run_id: str, timeout: float = 15) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = m.get(run_id)
        if run["state"] in TERMINAL:
            return run
        time.sleep(0.01)
    pytest.fail(f"run {run_id} did not end")


def test_document_text_is_kept_only_until_the_run_ends(tmp_path: Path) -> None:
    m, store = manager(tmp_path, step=0.2)
    run = submit(m, "k1")
    held = store.get(run["id"])
    assert held is not None
    assert held["request"] is not None, (
        "kept while the run is not finished, so a restart can run it"
    )
    done = wait(m, run["id"])
    assert done["state"] == "succeeded"
    ended = store.get(run["id"])
    assert ended is not None
    assert ended["request"] is None, "the document text is dropped when the run ends"
    m.shutdown()


def test_a_run_a_restart_interrupted_is_run_again(tmp_path: Path) -> None:
    m1, store = manager(tmp_path)
    payload = body()
    request = parse_request(payload, Limits())
    store.create("interrupted", "k-restart", body_digest(payload), request.to_json(), time.time())
    store.update(
        "interrupted", state="running", progress={"requirements_total": 8, "requirements_done": 3}
    )
    m1.shutdown()
    m2 = RunManager(RunStore(tmp_path / "runs.sqlite"), FakeRunner(0.01), Limits())
    assert m2.recover() == 1
    assert wait(m2, "interrupted")["state"] == "succeeded"
    again = submit(m2, "k-restart")
    assert again["id"] == "interrupted", "the key still names the same run after a restart"
    m2.shutdown()


def test_a_cancelling_run_a_restart_interrupted_ends_cancelled(tmp_path: Path) -> None:
    m, store = manager(tmp_path)
    request = parse_request(body(), Limits())
    store.create("c1", "k-c", "digest", request.to_json(), time.time())
    store.update("c1", state="cancelling")
    assert m.recover() == 0
    run = m.get("c1")
    assert run["state"] == "cancelled"
    row = store.get("c1")
    assert row is not None
    assert row["request"] is None
    m.shutdown()


def test_a_bug_in_a_run_never_reaches_the_caller(tmp_path: Path) -> None:
    m, _ = manager(tmp_path)
    payload = body("crash")
    crashed = m.submit("k-crash", body_digest(payload), payload)
    done = wait(m, crashed["id"])
    assert done["state"] == "failed"
    assert done["error"]["kind"] == "internal"
    assert "secret document text" not in str(done), "the error says nothing about what went wrong"
    m.shutdown()


def test_cancelling_a_queued_run_ends_it_without_running(tmp_path: Path) -> None:
    store = RunStore(tmp_path / "runs.sqlite")
    runner = FakeRunner(5.0)
    m = RunManager(store, runner, Limits(), workers=1)
    first = submit(m, "k-a")  # occupies the only worker
    second = submit(m, "k-b")  # waits in the queue
    view, in_progress = m.cancel(second["id"])
    assert (view["state"], in_progress) == ("cancelled", True)
    m.cancel(first["id"])
    assert wait(m, first["id"])["state"] == "cancelled"
    assert m.get(second["id"])["state"] == "cancelled"
    m.shutdown()


def test_the_run_store_refuses_what_it_does_not_know(tmp_path: Path) -> None:
    store = RunStore(tmp_path / "runs.sqlite")
    store.create("r1", "key", "d", {"x": 1}, 1.0)
    with pytest.raises(sqlite3.IntegrityError):
        store.create("r2", "key", "d", {"x": 1}, 2.0)  # the key is unique
    with pytest.raises(ValueError, match="not a run column"):
        store.update("r1", idem_key="other")
    assert store.set_state("r1", "running", ("queued",)) is True
    assert store.set_state("r1", "cancelled", ("queued",)) is False, "only from the states named"
    assert store.active_count() == 1
    store.delete("r1")
    assert store.get("r1") is None


def test_the_request_round_trips_through_the_store() -> None:
    request = parse_request(body(max_calls=5, extract_max_calls=3), Limits())
    assert RunRequest.from_json(request.to_json()) == request


def test_the_readiness_probe_says_503_when_the_store_cannot_be_read(tmp_path: Path) -> None:
    m, store = manager(tmp_path)
    app = create_app(m, "s", FakeRunner().info(), Limits())
    with serve_app(app) as base:
        assert get(f"{base}/readyz") == (200, {"status": "ready"})
        store.path.unlink()
        store.path.parent.chmod(0o500)
        try:
            status, got = get(f"{base}/readyz")
        finally:
            store.path.parent.chmod(0o700)
    assert (status, got) == (503, {"status": "unavailable"})
    m.shutdown()


def test_an_unexpected_error_is_a_problem_with_no_detail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    m, _ = manager(tmp_path)

    def boom(_run_id: str) -> dict[str, Any]:
        raise RuntimeError("secret document text")

    monkeypatch.setattr(m, "get", boom)
    with serve_app(create_app(m, "s", FakeRunner().info(), Limits())) as base:
        status, got = get(f"{base}/v1/runs/abc", secret="s")  # noqa: S106 -- a test value
    assert status == 500
    assert got["code"] == "internal"
    assert "secret" not in str(got)
    m.shutdown()


def test_the_readiness_probe_asks_the_runner_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    m, _ = manager(tmp_path)

    def broken() -> None:
        raise RuntimeError("the reply cache is not usable")

    monkeypatch.setattr(m.runner, "ready", broken)
    with serve_app(create_app(m, "s", FakeRunner().info(), Limits())) as base:
        assert get(f"{base}/readyz") == (503, {"status": "unavailable"})
    m.shutdown()
