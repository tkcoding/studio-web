"""Contract tests for the matcher service API (T9, HYP-3174).

Two halves. The first reads `schemas/service/matcher-service.openapi.yaml` and checks the rules the
contract sets itself (every operation declares the failures a caller must handle, one source for the
report schema, no `matcher` field). The second starts the real service (FastAPI, on uvicorn, on a
free port) with a runner that makes no model call (`service_fakes.FakeRunner`) and checks that
what it answers conforms to the schemas in that file, and that the promises in the descriptions
hold: idempotent retry, partial is an outcome, cancel, size limits, and so on.

Any implementation of the service must pass the second half: return its address from the
`service` fixture.
"""

import hashlib
import json
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from service_fakes import FakeRunner, serve_app

from gears_matcher.service.app import create_app
from gears_matcher.service.manager import RunManager
from gears_matcher.service.request import Limits
from gears_matcher.service.store import RunStore

ROOT = Path(__file__).parents[1]
SPEC_PATH = ROOT / "schemas/service/matcher-service.openapi.yaml"
SECRET = "test-secret"  # noqa: S105 -- a test value, not a credential
TERMINAL = {"succeeded", "partial", "failed", "cancelled"}
STEP = (
    0.02  # seconds per requirement in the fake runner: a run of 8 takes about a fifth of a second
)


SPEC: dict[str, Any] = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))


def _validator(name: str) -> Draft202012Validator:
    """A validator for `#/components/schemas/<name>` that can resolve the file's other `$ref`s."""
    return Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": SPEC["components"]}
    )


def _operations() -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (method, path, op)
        for path, item in SPEC["paths"].items()
        for method, op in item.items()
        if method in {"get", "post"}
    ]


# --- the file itself ------------------------------------------------------------------------------


def test_spec_declares_the_operations() -> None:
    assert {(m, p) for m, p, _ in _operations()} == {
        ("get", "/healthz"),
        ("get", "/readyz"),
        ("post", "/v1/runs"),
        ("get", "/v1/runs/{runId}"),
        ("get", "/v1/runs/{runId}/report"),
        ("post", "/v1/runs/{runId}/cancel"),
        ("get", "/v1/info"),
    }


def test_operation_ids_are_unique() -> None:
    ids = [op["operationId"] for _, _, op in _operations()]
    assert len(ids) == len(set(ids))


def _authenticated() -> list[tuple[str, str, dict[str, Any]]]:
    return [o for o in _operations() if o[2].get("security") != []]


@pytest.mark.parametrize(("method", "path", "op"), _authenticated())
def test_every_operation_declares_the_failures_a_caller_must_handle(
    method: str, path: str, op: dict[str, Any]
) -> None:
    assert {"401", "500", "503"} <= set(op["responses"]), f"{method} {path}"


@pytest.mark.parametrize(("method", "path", "op"), _operations())
def test_every_operation_is_documented(method: str, path: str, op: dict[str, Any]) -> None:
    assert 0 < len(op["summary"]) <= 120, f"{method} {path}: summary"
    assert len(op["description"]) >= 40, f"{method} {path}: description"


def test_submit_requires_an_idempotency_key_and_answers_202_for_a_repeat_too() -> None:
    submit = SPEC["paths"]["/v1/runs"]["post"]
    keys = [p for p in submit["parameters"] if p["name"] == "Idempotency-Key"]
    assert len(keys) == 1
    assert keys[0]["required"] is True
    assert "200" not in submit["responses"], "a repeat answers the same 202 as the first submit"
    assert "202" in submit["responses"]


def test_the_request_has_no_matcher_field() -> None:
    request = SPEC["components"]["schemas"]["RunRequest"]
    assert "matcher" not in request["properties"]
    assert request["additionalProperties"] is False


def test_the_report_schema_has_one_source() -> None:
    report = SPEC["components"]["schemas"]["CoverageReport"]
    assert "coverage-report.schema.json" in report["description"]
    assert set(report["properties"]) == {"schema_version"}, "the report schema is not copied here"
    assert (ROOT / "schemas/coverage-report.schema.json").is_file()


def test_every_run_state_is_covered_by_the_terminal_rule() -> None:
    states = set(SPEC["components"]["schemas"]["Run"]["properties"]["state"]["enum"])
    assert states > TERMINAL
    assert states - TERMINAL == {"queued", "running", "cancelling"}


# --- the mock, held to the file -------------------------------------------------------------------


class Service:
    """A tiny HTTP client for the service under test."""

    def __init__(self, base: str) -> None:
        self.base = base

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        key: str | None = None,
        secret: str | None = SECRET,
    ) -> tuple[int, dict[str, str], Any]:
        headers = {"Content-Type": "application/json"}
        if secret is not None:
            headers["Authorization"] = f"Bearer {secret}"
        if key is not None:
            headers["Idempotency-Key"] = key
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
                return (
                    resp.status,
                    {k.title(): v for k, v in resp.headers.items()},
                    json.loads(resp.read()),
                )
        except urllib.error.HTTPError as err:
            return err.code, {k.title(): v for k, v in err.headers.items()}, json.loads(err.read())

    def wait(self, run_id: str, timeout: float = 15) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status, _, run = self.call("GET", f"/v1/runs/{run_id}")
            assert status == 200
            if run["state"] in TERMINAL:
                return run  # type: ignore[no-any-return]
            time.sleep(STEP)
        pytest.fail(f"run {run_id} did not end")


def _serve(step: float, pg_url: str) -> Iterator[Service]:
    runner = FakeRunner(step)
    limits = Limits(max_concurrent_runs=2)
    store = RunStore(pg_url)
    manager = RunManager(store, runner, limits, workers=4)
    with serve_app(create_app(manager, SECRET, runner.info(), limits)) as base:
        yield Service(base)
    manager.shutdown()
    store.close()


@pytest.fixture
def service(pg_url: str) -> Iterator[Service]:
    """The service under test. To test another implementation, return its `Service(address)`."""
    yield from _serve(STEP, pg_url)


@pytest.fixture
def slow_service(pg_url: str) -> Iterator[Service]:
    """Runs stay in progress for seconds, to test cancel and the concurrency cap."""
    yield from _serve(5.0, pg_url)


def _doc(path: str = "specs/docs/prd/todo.md", text: str = "# Todo\n") -> dict[str, str]:
    return {"path": path, "sha256": hashlib.sha256(text.encode()).hexdigest(), "content": text}


def _request(**extra: Any) -> dict[str, Any]:
    return {"product": "todo-app", "documents": [_doc()], **extra}


def _problem(status: int, body: Any, code: str) -> None:
    _validator("Problem").validate(body)
    assert body["status"] == status
    assert body["code"] == code


def test_info_conforms_and_lists_the_report_versions(service: Service) -> None:
    status, _, info = service.call("GET", "/v1/info")
    assert status == 200
    _validator("Info").validate(info)
    assert info["report_schema_versions"]


def test_a_call_without_the_secret_is_401(service: Service) -> None:
    for method, path in (("GET", "/v1/info"), ("POST", "/v1/runs")):
        status, _, body = service.call(method, path, secret=None)
        assert status == 401
        _problem(401, body, "unauthorized")
    status, _, body = service.call("GET", "/v1/info", secret="wrong")  # noqa: S106 -- a test value
    assert status == 401


def test_submit_is_202_with_a_run_and_its_address(service: Service) -> None:
    status, headers, run = service.call("POST", "/v1/runs", _request(), key="k-1")
    assert status == 202
    _validator("Run").validate(run)
    assert run["state"] == "queued"
    assert headers["Location"] == f"/v1/runs/{run['id']}"


def test_a_retried_submit_is_the_same_run_and_the_same_202(service: Service) -> None:
    first = service.call("POST", "/v1/runs", _request(), key="k-2")
    again = service.call("POST", "/v1/runs", _request(), key="k-2")
    assert first[0] == again[0] == 202
    assert first[2]["id"] == again[2]["id"]
    assert again[1]["Location"] == first[1]["Location"]


def test_the_same_key_with_another_body_is_409(service: Service) -> None:
    service.call("POST", "/v1/runs", _request(), key="k-3")
    status, _, body = service.call(
        "POST", "/v1/runs", {**_request(), "product": "other"}, key="k-3"
    )
    assert status == 409
    _problem(409, body, "idempotency_conflict")


@pytest.mark.parametrize("key", [None, "", "has space", "x" * 129])
def test_a_bad_or_missing_key_is_400(service: Service, key: str | None) -> None:
    status, _, body = service.call("POST", "/v1/runs", _request(), key=key)
    assert status == 400
    _problem(400, body, "bad_request")


def test_a_refused_submit_stores_nothing_so_the_same_key_can_be_reused(service: Service) -> None:
    broken = _request(documents=[{**_doc(), "sha256": "0" * 64}])
    status, _, body = service.call("POST", "/v1/runs", broken, key="k-4")
    assert status == 422
    _problem(422, body, "hash_mismatch")
    status, _, run = service.call("POST", "/v1/runs", _request(), key="k-4")  # fixed, same key
    assert status == 202
    _validator("Run").validate(run)


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"product": "p"}, 400, "bad_request"),
        ({"product": "p", "documents": [], "matcher": "verified"}, 400, "bad_request"),
        (_request(documents=[_doc(path="../x.md")]), 422, "bad_path"),
        (_request(documents=[_doc(path="/abs.md")]), 422, "bad_path"),
        (_request(documents=[_doc(path="notes.txt")]), 422, "bad_path"),
        (_request(documents=[_doc(path="a\\b.md")]), 422, "bad_path"),
        (_request(documents=[_doc(path="a\nb.md")]), 422, "bad_path"),
        (_request(own_gears=["not a gear id"]), 422, "unknown_own_gear"),
        (_request(options={"max_calls": 10**6}), 422, "over_cap"),
        (_request(options={"extract_max_calls": 0}), 400, "bad_request"),
        (_request(options={"extract_max_calls": 10**6}), 422, "over_cap"),
        ({**_request(), "product": "freeform"}, 422, "not_a_template"),
    ],
)
def test_a_bad_request_is_refused_before_any_run_starts(
    service: Service, body: dict[str, Any], status: int, code: str
) -> None:
    got, _, problem = service.call("POST", "/v1/runs", body, key="k-bad")
    assert got == status
    _problem(status, problem, code)


def test_a_run_walks_to_succeeded_and_has_a_report(service: Service) -> None:
    _, _, run = service.call("POST", "/v1/runs", _request(), key="k-5")
    done = service.wait(run["id"])
    _validator("Run").validate(done)
    assert done["state"] == "succeeded"
    assert done["outcome"]["not_assessed"] == 0
    status, _, report = service.call("GET", done["outcome"]["report_url"])
    assert status == 200
    _validator("CoverageReport").validate(report)
    _, _, info = service.call("GET", "/v1/info")
    assert report["schema_version"] in info["report_schema_versions"]


def test_partial_is_an_outcome_with_a_report_not_a_failure(service: Service) -> None:
    _, _, run = service.call("POST", "/v1/runs", _request(options={"max_calls": 5}), key="k-6")
    done = service.wait(run["id"])
    assert done["state"] == "partial"
    assert done["outcome"]["not_assessed"] > 0
    assert "error" not in done
    status, _, report = service.call("GET", f"/v1/runs/{run['id']}/report")
    assert status == 200
    assert "schema_version" in report


def test_a_failed_run_has_an_error_and_no_report(service: Service) -> None:
    _, _, run = service.call("POST", "/v1/runs", {**_request(), "product": "boom"}, key="k-7")
    done = service.wait(run["id"])
    assert done["state"] == "failed"
    assert done["error"]["kind"] in {"input", "internal"}
    status, _, body = service.call("GET", f"/v1/runs/{run['id']}/report")
    assert status == 409
    _problem(409, body, "no_report")


def test_the_report_of_a_run_in_progress_is_409(slow_service: Service) -> None:
    _, _, run = slow_service.call("POST", "/v1/runs", _request(), key="k-8")
    status, _, body = slow_service.call("GET", f"/v1/runs/{run['id']}/report")
    assert status == 409
    _problem(409, body, "no_report")


def test_an_unknown_run_is_404_everywhere(service: Service) -> None:
    for method, path in (
        ("GET", "/v1/runs/nope"),
        ("GET", "/v1/runs/nope/report"),
        ("POST", "/v1/runs/nope/cancel"),
    ):
        status, _, body = service.call(method, path)
        assert status == 404
        _problem(404, body, "not_found")


def test_cancel_stops_the_run_and_still_counts_the_calls_in_flight(slow_service: Service) -> None:
    _, _, run = slow_service.call("POST", "/v1/runs", _request(), key="k-9")
    time.sleep(0.1)
    status, _, cancelling = slow_service.call("POST", f"/v1/runs/{run['id']}/cancel")
    assert status == 202
    assert cancelling["state"] in {"cancelling", "cancelled"}
    done = slow_service.wait(run["id"], timeout=20)
    assert done["state"] == "cancelled"
    assert done["usage"]["calls"] >= 1, "a call in flight when it was cancelled is still counted"
    status, _, body = slow_service.call("GET", f"/v1/runs/{run['id']}/report")
    assert status == 409
    _problem(409, body, "no_report")


def test_cancelling_an_ended_run_changes_nothing_and_is_200(service: Service) -> None:
    _, _, run = service.call("POST", "/v1/runs", _request(), key="k-10")
    done = service.wait(run["id"])
    status, _, again = service.call("POST", f"/v1/runs/{run['id']}/cancel")
    assert status == 200
    assert again["state"] == done["state"] == "succeeded"
    status, _, twice = service.call("POST", f"/v1/runs/{run['id']}/cancel")
    assert (status, twice["state"]) == (200, "succeeded")


def test_too_many_runs_at_once_is_429_with_retry_after(slow_service: Service) -> None:
    _, _, info = slow_service.call("GET", "/v1/info")
    cap = info["limits"]["max_concurrent_runs"]
    for n in range(cap):
        assert slow_service.call("POST", "/v1/runs", _request(), key=f"k-cap-{n}")[0] == 202
    status, headers, body = slow_service.call("POST", "/v1/runs", _request(), key="k-cap-over")
    assert status == 429
    assert int(headers["Retry-After"]) > 0
    _problem(429, body, "busy")


def test_problem_codes_are_the_documented_ones(service: Service) -> None:
    documented = SPEC["components"]["schemas"]["Problem"]["properties"]["code"]["description"]
    for code in (
        "unauthorized",
        "bad_request",
        "idempotency_conflict",
        "hash_mismatch",
        "bad_path",
        "no_report",
    ):
        assert f"`{code}`" in documented


def test_a_free_form_spec_is_read_when_extraction_is_bounded(service: Service) -> None:
    body = {**_request(options={"extract_max_calls": 20}), "product": "freeform"}
    status, _, run = service.call("POST", "/v1/runs", body, key="k-free")
    assert status == 202
    _validator("Run").validate(run)


def test_the_extraction_bound_is_in_the_contract() -> None:
    options = SPEC["components"]["schemas"]["RunOptions"]["properties"]
    assert options["extract_max_calls"]["minimum"] == 1
    limits = SPEC["components"]["schemas"]["Info"]["properties"]["limits"]["properties"]
    assert "max_extract_calls" in limits
    codes = SPEC["components"]["schemas"]["Problem"]["properties"]["code"]["description"]
    assert "`not_a_template`" in codes
    assert "`unreadable_spec`" in codes


NAMES = ["PRD v2.md", "docs/Product Requirements.md", "é.md", "需求/说明.md"]


@pytest.mark.parametrize("path", NAMES)
def test_a_file_name_with_spaces_or_non_ascii_is_accepted(service: Service, path: str) -> None:
    body = _request(documents=[_doc(path=path)])
    status, _, run = service.call("POST", "/v1/runs", body, key=f"k-name-{NAMES.index(path)}")
    assert status == 202
    _validator("Run").validate(run)


def test_a_large_multi_file_spec_is_accepted(service: Service) -> None:
    """Many large documents, just under every limit."""
    _, _, info = service.call("GET", "/v1/info")
    limits = info["limits"]
    count = limits["max_documents"] - 1
    each = (limits["max_request_bytes"] - 20_000) // count
    assert each < limits["max_document_bytes"]
    docs = [_doc(path=f"d{n}.md", text="y" * each) for n in range(count)]
    status, _, run = service.call("POST", "/v1/runs", _request(documents=docs), key="k-large")
    assert status == 202
    _validator("Run").validate(run)


def test_a_multi_file_spec_from_real_files_is_accepted(service: Service) -> None:
    root = ROOT / "tests/fixtures/spec/free-form"
    files = sorted(root.rglob("*.md"))
    assert len(files) > 3
    docs = [_doc(path=str(f.relative_to(root)), text=f.read_text(encoding="utf-8")) for f in files]
    status, _, _ = service.call("POST", "/v1/runs", _request(documents=docs), key="k-files")
    assert status == 202


def test_a_request_over_the_size_limit_gets_a_413_not_a_dropped_connection(
    service: Service,
) -> None:
    """The caller is still sending when the service refuses: it must still receive the answer."""
    _, _, info = service.call("GET", "/v1/info")
    over = info["limits"]["max_request_bytes"] + 100_000
    docs = [_doc(path=f"d{n}.md", text="z" * 100_000) for n in range(over // 100_000 + 1)]
    status, _, body = service.call("POST", "/v1/runs", _request(documents=docs), key="k-over")
    assert status == 413
    _problem(413, body, "too_large")


def test_a_document_over_its_own_limit_is_413(service: Service) -> None:
    _, _, info = service.call("GET", "/v1/info")
    big = _doc(text="x" * (info["limits"]["max_document_bytes"] + 1))
    status, _, body = service.call("POST", "/v1/runs", _request(documents=[big]), key="k-bigdoc")
    assert status == 413
    _problem(413, body, "too_large")


def test_the_probes_need_no_secret(service: Service) -> None:
    for path, expected in (("/healthz", "ok"), ("/readyz", "ready")):
        status, _, body = service.call("GET", path, secret=None)
        assert status == 200
        assert body == {"status": expected}
