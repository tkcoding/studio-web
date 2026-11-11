"""The matching pipeline, for every command that runs it (T6's `gears-match`, T7's `gears-eval`).

T3 shortlists each requirement, T4 judges it through the seam, T5 builds the report. Reading the
spec (T2) and the catalogue (T1), choosing the judge, and writing the report stay with the command:
this module takes them as given, writes nothing and prints nothing (T7 note §9: one copy of the
pipeline, not two).
"""

from collections.abc import Callable
from dataclasses import dataclass

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.judge import MatchJudge, judge_requirement
from gears_matcher.models import Clarification, Match
from gears_matcher.report import DEFAULT_TAU, CoverageReport, RunSettings, build_report
from gears_matcher.retrieval import DEFAULT_K, RetrievalError, retrieve
from gears_matcher.spec import Spec

__all__ = ["PipelineError", "PipelineOptions", "PipelineResult", "run_pipeline"]

# Called after each requirement is judged: (how many done, how many in all, its id).
Progress = Callable[[int, int, str], None]


class PipelineError(Exception):
    """The pipeline cannot run on these inputs (the shortlist cannot be made): bad input."""


@dataclass(frozen=True)
class PipelineOptions:
    """How to run it: the judge and its name in the report, the shortlist size and τ."""

    judge: MatchJudge
    judge_name: str  # recorded in the report
    top_k: int = DEFAULT_K
    tau: float = DEFAULT_TAU
    progress: Progress | None = None
    extraction: str | None = None  # how free-form requirements were read, for the report (T8)
    clarifications: tuple[Clarification, ...] = ()  # topics to ask the author (#65, T8 D11)


@dataclass(frozen=True)
class PipelineResult:
    report: CoverageReport
    # Requirements the judge's call bound stopped before they were judged (T6 D4: exit 1).
    cut_by_bound: frozenset[str]


def run_pipeline(spec: Spec, catalogue: Catalogue, options: PipelineOptions) -> PipelineResult:
    """Shortlist, judge and report every requirement of `spec` against `catalogue`."""
    try:
        shortlists = retrieve(spec.requirements, catalogue, k=options.top_k)
    except RetrievalError as exc:
        raise PipelineError(f"the shortlist cannot be made: {exc}") from exc
    gears = {g.id: g for g in catalogue.gears}
    shortlist = {rid: [c.gear_id for c in s.candidates] for rid, s in shortlists.items()}
    matches: list[Match] = []
    cut = set()
    for n, req in enumerate(spec.requirements, 1):
        found = judge_requirement(options.judge, req, [gears[g] for g in shortlist[req.id]])
        matches += found
        if any(m.problem is not None and m.problem.kind == "budget_exceeded" for m in found):
            cut.add(req.id)
        if options.progress is not None:
            options.progress(n, len(spec.requirements), req.id)
    settings = RunSettings(
        judge=options.judge_name,
        shortlist=f"tf-idf, k={options.top_k}",
        tau=options.tau,
        extraction=options.extraction,
    )
    report = build_report(
        spec,
        catalogue,
        shortlist,
        matches,
        settings=settings,
        clarifications=options.clarifications,
    )
    return PipelineResult(report, frozenset(cut))
