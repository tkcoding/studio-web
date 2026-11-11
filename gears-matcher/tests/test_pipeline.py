"""The pipeline every command runs (T7 note §9): shortlist, judge, report; nothing written."""

from collections.abc import Sequence
from pathlib import Path

import pytest

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.judge import BudgetExceeded, GearCard, JudgeReply, StubJudge
from gears_matcher.pipeline import PipelineError, PipelineOptions, run_pipeline
from gears_matcher.report import validated_json
from gears_matcher.spec import Requirement, Spec, load_spec

ROOT = Path(__file__).parents[1]
PRD = Path("tests/fixtures/spec/todo-app/PRD.md")  # relative to ROOT, as T6's golden report has it
GOLDEN = ROOT / "tests/fixtures/golden/todo-app.report.json"


@pytest.fixture
def todo_app(monkeypatch: pytest.MonkeyPatch) -> Spec:
    monkeypatch.chdir(ROOT)
    return load_spec(PRD, None)


def test_the_report_is_the_one_gears_match_writes(
    todo_app: Spec, fixture_catalogue: Catalogue
) -> None:  # the same pipeline as T6, so T6's golden report is its answer too
    result = run_pipeline(todo_app, fixture_catalogue, PipelineOptions(StubJudge(), "stub"))
    assert validated_json(result.report) == GOLDEN.read_text(encoding="utf-8")
    assert result.cut_by_bound == frozenset()


def test_progress_is_reported_once_per_requirement_in_spec_order(
    todo_app: Spec, fixture_catalogue: Catalogue
) -> None:
    seen: list[tuple[int, int, str]] = []
    options = PipelineOptions(StubJudge(), "stub", progress=lambda *a: seen.append(a))
    run_pipeline(todo_app, fixture_catalogue, options)
    total = len(todo_app.requirements)
    assert seen == [(n, total, r.id) for n, r in enumerate(todo_app.requirements, 1)]


class _BoundAfter:
    """A judge whose call bound is used up after `calls` requirements."""

    def __init__(self, calls: int) -> None:
        self.left = calls
        self.asked: list[str] = []  # requirements with candidates, in the order they were sent

    def judge(self, requirement: Requirement, cards: Sequence[GearCard]) -> Sequence[JudgeReply]:
        self.asked.append(requirement.id)
        if self.left == 0:
            raise BudgetExceeded("used up")
        self.left -= 1
        return StubJudge().judge(requirement, cards)


def test_requirements_the_call_bound_stopped_are_named(
    todo_app: Spec, fixture_catalogue: Catalogue
) -> None:  # T6 D4: the command turns these into exit 1
    judge = _BoundAfter(2)
    result = run_pipeline(todo_app, fixture_catalogue, PipelineOptions(judge, "bound"))
    assert len(judge.asked) > 2  # so something was cut
    assert result.cut_by_bound == frozenset(judge.asked[2:])


def test_settings_are_recorded_in_the_report(todo_app: Spec, fixture_catalogue: Catalogue) -> None:
    options = PipelineOptions(StubJudge(), "a judge", top_k=3, tau=0.7)
    provenance = run_pipeline(todo_app, fixture_catalogue, options).report.provenance
    settings = (provenance.judge, provenance.shortlist, provenance.tau)
    assert settings == ("a judge", "tf-idf, k=3", 0.7)


def test_a_shortlist_that_cannot_be_made_is_a_pipeline_error(
    todo_app: Spec, fixture_catalogue: Catalogue
) -> None:  # bad input, which the command reports as exit 2, not a bug
    with pytest.raises(PipelineError, match="the shortlist cannot be made"):
        run_pipeline(todo_app, fixture_catalogue, PipelineOptions(StubJudge(), "stub", top_k=0))
