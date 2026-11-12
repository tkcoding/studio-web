"""The real runner and the process settings, on a fake model and the fixture catalogue.

What is checked here is the wiring the contract tests cannot see: a request becomes a spec bundle on
disk, T2 reads it, the matcher runs, and what comes back is what the service reports.
"""

import hashlib
import json
import socket
from pathlib import Path

import pytest
from test_run import FakeModel, coded

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.service.__main__ import Settings, SettingsError
from gears_matcher.service.errors import ProblemError
from gears_matcher.service.request import Document, Limits, RunRequest
from gears_matcher.service.runner import Cancelled, RealRunner, RunFailed, write_spec

PRD = (Path(__file__).parent / "fixtures/spec/todo-app/PRD.md").read_text(encoding="utf-8")
NOTES = (
    "# Notes\n\n- Users can sign in with their company account.\n- Users must not share accounts.\n"
)


class Meter:
    def __init__(self, stop_after_calls: int | None = None) -> None:
        self.stop_after = stop_after_calls
        self.progress_seen: list[tuple[int, int]] = []
        self.usage_seen: list[tuple[int, int, int, int]] = []

    def cancelled(self) -> bool:
        return (
            self.stop_after is not None
            and bool(self.usage_seen)
            and self.usage_seen[-1][0] >= self.stop_after
        )

    def progress(self, done: int, total: int) -> None:
        self.progress_seen.append((done, total))

    def usage(self, calls: int, cache_hits: int, input_tokens: int, output_tokens: int) -> None:
        self.usage_seen.append((calls, cache_hits, input_tokens, output_tokens))


@pytest.fixture(autouse=True)
def _fake_model_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear CI (the matcher refuses a catalogue model there: it would call a paid model) and shut
    the network, so these tests run the real runner on a fake model and cannot reach a real one."""
    monkeypatch.delenv("CI", raising=False)

    def refuse(self: socket.socket, address: object) -> None:
        raise AssertionError(f"a test tried to connect to {address!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)


def doc(path: str, text: str) -> Document:
    return Document(path, hashlib.sha256(text.encode()).hexdigest(), text)


def request(*docs: Document, **more: object) -> RunRequest:
    return RunRequest(product="todo-app", documents=docs or (doc("specs/PRD.md", PRD),), **more)  # type: ignore[arg-type]


def runner(tmp_path: Path, catalogue: Catalogue, model: FakeModel, **more: object) -> RealRunner:
    return RealRunner(
        catalogue, lambda name: (f"fake:{name}", model), tmp_path / "cache", tmp_path / "work",
        **more,  # type: ignore[arg-type]
    )  # fmt: skip


def test_the_documents_become_a_bundle_with_a_manifest(tmp_path: Path) -> None:
    write_spec(request(doc("specs/PRD.md", PRD), doc("notes/Meeting notes.md", NOTES)), tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    (product,) = manifest["products"]
    assert product["id"] == "todo-app"
    assert [f["path"] for f in product["files"]] == ["specs/PRD.md", "notes/Meeting notes.md"]
    assert product["files"][0]["sha256"] == hashlib.sha256(PRD.encode()).hexdigest()
    assert (tmp_path / "notes/Meeting notes.md").read_text() == NOTES


def test_a_cf_spec_passes_the_preflight_and_runs(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    model = FakeModel(coded(fixture_catalogue))
    real = runner(tmp_path, fixture_catalogue, model)
    req = request(max_calls=100)
    real.preflight(req)
    assert model.calls == 0, "the preflight pays for nothing"
    meter = Meter()
    outcome = real.run(req, meter)
    report = json.loads(outcome.report_json)
    assert (outcome.requirements, outcome.not_assessed) == (8, 0)
    assert report["totals"]["requirements"] == 8
    assert meter.progress_seen[-1] == (8, 8)
    assert meter.usage_seen[-1][0] == model.calls, "the last usage is the run's whole cost"
    assert not list((tmp_path / "work").iterdir()), "the scratch folder is removed"


def test_a_spec_not_in_the_format_is_refused_at_submit_unless_reading_is_allowed(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    real = runner(tmp_path, fixture_catalogue, FakeModel(coded(fixture_catalogue)))
    free = request(doc("notes.md", NOTES))
    with pytest.raises(ProblemError) as caught:
        real.preflight(free)
    assert (caught.value.status.value, caught.value.code) == (422, "not_a_template")
    real.preflight(request(doc("notes.md", NOTES), extract_max_calls=5))  # allowed: no error


def test_unknown_own_gears_and_a_missing_bundle_are_refused(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    real = runner(tmp_path, fixture_catalogue, FakeModel(coded(fixture_catalogue)))
    with pytest.raises(ProblemError) as own:
        real.preflight(request(own_gears=("gears-rust/nope",)))
    assert own.value.code == "unknown_own_gear"
    with pytest.raises(ProblemError) as bundle:
        real.preflight(request(use_gears_bundle=True))
    assert bundle.value.code == "bundle_unavailable"


def test_cancel_stops_the_real_run(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    model = FakeModel(coded(fixture_catalogue))
    with pytest.raises(Cancelled):
        runner(tmp_path, fixture_catalogue, model).run(
            request(max_calls=100), Meter(stop_after_calls=1)
        )
    assert model.calls == 1


def test_a_problem_found_while_running_ends_the_run_failed_with_its_code(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    model = FakeModel(coded(fixture_catalogue))
    with pytest.raises(RunFailed) as failed:
        runner(tmp_path, fixture_catalogue, model).run(request(doc("notes.md", NOTES)), Meter())
    assert failed.value.kind == "input"
    assert failed.value.message.startswith("not_a_template")


def test_info_says_what_the_service_runs(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    info = runner(tmp_path, fixture_catalogue, FakeModel(coded(fixture_catalogue))).info()
    assert info["models"] == ["claude-sonnet-4-6", "claude-opus-5", "gpt-5.4"]
    assert info["report_schema_versions"] == ["1.2.0"]
    assert set(info["catalogue"]) == {"source", "gears_md_commit", "gear_gdl_commit"}


DB = "postgresql://matcher@db/gears_matcher"


def test_settings_need_a_secret_a_checkout_and_a_database(tmp_path: Path) -> None:
    with pytest.raises(SettingsError, match="GEARS_MATCHER_SECRET"):
        Settings.from_env({})
    with pytest.raises(SettingsError, match="GEARS_RUST_REPO"):
        Settings.from_env({"GEARS_MATCHER_SECRET": "s", "GEARS_RUST_REPO": str(tmp_path / "none")})
    base = {"GEARS_MATCHER_SECRET": "s", "GEARS_RUST_REPO": str(tmp_path)}
    with pytest.raises(SettingsError, match="GEARS_MATCHER_DATABASE_URL"):
        Settings.from_env(base)
    good = Settings.from_env({**base, "GEARS_MATCHER_DATABASE_URL": DB})
    assert Settings.from_env({**base, "PGHOST": "db"}).database == "", "libpq reads PG* itself"
    assert (good.port, good.workers, good.limits.max_concurrent_runs) == (8080, 4, None)
    assert good.limits == Limits()


def test_the_per_run_call_bound_is_a_setting(tmp_path: Path) -> None:
    env = {"GEARS_MATCHER_SECRET": "s", "GEARS_RUST_REPO": str(tmp_path), "PGHOST": "db"}
    assert Settings.from_env(env).limits.max_calls == 400
    got = Settings.from_env(
        {**env, "GEARS_MATCHER_MAX_CALLS": "600", "GEARS_MATCHER_MAX_EXTRACT_CALLS": "40"}
    )
    assert (got.limits.max_calls, got.limits.max_extract_calls) == (600, 40)
    with pytest.raises(SettingsError, match="GEARS_MATCHER_MAX_CALLS"):
        Settings.from_env({**env, "GEARS_MATCHER_MAX_CALLS": "0"})


def test_settings_read_numbers_and_refuse_bad_ones(tmp_path: Path) -> None:
    env = {"GEARS_MATCHER_SECRET": "s", "GEARS_RUST_REPO": str(tmp_path), "PGHOST": "db"}
    got = Settings.from_env(
        {**env, "GEARS_MATCHER_PORT": "9000", "GEARS_MATCHER_MAX_CONCURRENT_RUNS": "3"}
    )
    assert (got.port, got.limits.max_concurrent_runs) == (9000, 3)
    for bad in ("x", "0"):
        with pytest.raises(SettingsError, match="GEARS_MATCHER_WORKERS"):
            Settings.from_env({**env, "GEARS_MATCHER_WORKERS": bad})


def test_a_reply_cache_that_cannot_be_written_is_not_ready_and_fails_a_run_as_internal(
    fixture_catalogue: Catalogue, tmp_path: Path
) -> None:
    blocked = tmp_path / "cache"
    blocked.write_text("a file where the cache folder should be")
    model = FakeModel(coded(fixture_catalogue))
    real = RealRunner(
        fixture_catalogue, lambda name: (f"fake:{name}", model), blocked, tmp_path / "work"
    )
    with pytest.raises(RuntimeError, match="reply cache is not usable"):
        real.ready()
    with pytest.raises(RunFailed) as failed:
        real.run(request(max_calls=100), Meter())
    assert failed.value.kind == "internal", (
        "a broken mount is the service's problem, not the caller's"
    )
    assert str(blocked) not in failed.value.message, "and the caller is not told where"
    assert model.calls == 0


def test_a_usable_cache_is_ready(fixture_catalogue: Catalogue, tmp_path: Path) -> None:
    runner(tmp_path, fixture_catalogue, FakeModel(coded(fixture_catalogue))).ready()
