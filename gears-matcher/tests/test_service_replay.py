"""The real runner on replies recorded from the real models: no model, no network.

`fixtures/llm/verified-todo-app/` holds the 16 replies the `verified` matcher got from the real
models on the todo-app PRD (public; see `fixtures/README.md`). The service is run on them and must
give the report in `fixtures/golden/verified-todo-app.report.json`. That report is the one
`gears-match --matcher verified` gave on the same input and replies, apart from the document's path
(the command line records the file's path, the service the request's). A request the replies do
not cover would need a model, and fails here.

Needs a gears-rust checkout at the two pinned commits (set `GEARS_RUST_REPO`; CI fetches one).
"""

import json
import os
import shutil
from pathlib import Path

import pytest
from test_service_runner import PRD, Meter, doc

from gears_matcher.catalogue import build_from_repo
from gears_matcher.catalogue.models import Catalogue
from gears_matcher.judge.llm.run import DEFAULT_PROVIDER, provider_module
from gears_matcher.service.request import RunRequest
from gears_matcher.service.runner import RealRunner

HERE = Path(__file__).parent
REPO = Path(os.environ.get("GEARS_RUST_REPO", HERE.parents[1] / "gears-rust"))
REPLIES = HERE / "fixtures/llm/verified-todo-app"
GOLDEN = HERE / "fixtures/golden/verified-todo-app.report.json"


class NoModel:
    """Every reply must come from the recorded ones; a call that reaches here is a mismatch."""

    def complete(self, **_: object) -> object:
        raise AssertionError("a model call was needed: the recorded replies do not cover this run")


@pytest.fixture(autouse=True)
def _no_ci_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CI", raising=False)  # the matcher refuses a catalogue model when CI is set


@pytest.fixture(scope="module")
def full() -> Catalogue:
    if not (REPO / ".git").exists():
        if os.environ.get("CI"):
            pytest.fail(f"no gears-rust checkout at {REPO} in CI (the fetch step should set it)")
        pytest.skip("no gears-rust checkout (set GEARS_RUST_REPO)")
    return build_from_repo(REPO)


def test_the_service_gives_the_recorded_report_from_recorded_replies(
    full: Catalogue, tmp_path: Path
) -> None:
    shutil.copytree(REPLIES, tmp_path / "cache")
    label = provider_module(DEFAULT_PROVIDER).label  # the cache key holds the real model's label
    real = RealRunner(
        full, lambda name: (label(name), NoModel()), tmp_path / "cache", tmp_path / "work"  # type: ignore[arg-type,return-value]
    )  # fmt: skip
    req = RunRequest(product="todo-app", documents=(doc("specs/prd.md", PRD),), max_calls=1)
    real.preflight(req)
    meter = Meter()
    outcome = real.run(req, meter)

    assert (outcome.requirements, outcome.not_assessed) == (8, 0)
    assert meter.usage_seen[-1][0] == 0, "no model was called"
    assert meter.usage_seen[-1][1] == 16, "every reply came from the cache"
    assert json.loads(outcome.report_json) == json.loads(GOLDEN.read_text(encoding="utf-8"))
