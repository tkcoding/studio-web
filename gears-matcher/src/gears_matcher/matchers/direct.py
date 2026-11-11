"""T11: the `direct-sonnet` and `direct-opus` matchers (T11 note D9).

The keyword matcher with its shortlist replaced: one model (Sonnet or Opus) reads the whole
catalogue (`whole_catalogue`) and names the Gears for each requirement; those Gears are the
candidates, and the keyword matcher's own judge (T4 seam, T4b LLM judge) judges each one with its
evidence rules. The report is the same as the keyword matcher's. A requirement whose batch the model
could not answer is not assessed.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from gears_matcher.judge import MatchJudge, judge_requirement
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.whole_catalogue import CatalogueModelError, batches
from gears_matcher.models import Gear, Match, Requirement

__all__ = ["CANDIDATE_MODELS", "DirectResult", "run_direct"]

# matcher name -> the model that reads the whole catalogue (T11, Sanjeev 2026-11-02)
CANDIDATE_MODELS: dict[str, str] = {
    "direct-sonnet": "claude-sonnet-4-6",
    "direct-opus": "claude-opus-5",
}

# Answers one batch: requirement id -> ((gear id, verdict), ...). `CatalogueModel.answer` fits.
Answer = Callable[
    [Sequence[Requirement], Sequence[GearCard]], Mapping[str, Sequence[tuple[str, str]]]
]
Progress = Callable[[int, int, str], None]


@dataclass
class DirectResult:
    shortlist: dict[str, list[str]]
    matches: list[Match]
    failed: dict[str, str] = field(default_factory=dict)
    cut_by_bound: set[str] = field(default_factory=set)


def run_direct(  # noqa: PLR0913 -- the run's inputs, keyword-only after the requirements
    requirements: Sequence[Requirement],
    *,
    cards: Sequence[GearCard],
    gears: Mapping[str, Gear],
    answer: Answer,
    judge: MatchJudge,
    progress: Progress | None = None,
) -> DirectResult:
    """Candidates from `answer`, batch by batch; each requirement's candidates judged by `judge`."""
    result = DirectResult(shortlist={r.id: [] for r in requirements}, matches=[])
    done = 0
    for batch in batches(requirements):
        try:
            picks = answer(batch, cards)
        except CatalogueModelError as exc:
            for r in batch:
                result.failed[r.id] = (
                    f"the whole-catalogue model could not answer: {str(exc)[:200]}"
                )
            done += len(batch)
            continue
        for r in batch:
            candidates = list(dict.fromkeys(g for g, _ in picks.get(r.id, ())))
            result.shortlist[r.id] = candidates
            found = judge_requirement(judge, r, [gears[g] for g in candidates])
            result.matches += found
            if any(m.problem is not None and m.problem.kind == "budget_exceeded" for m in found):
                result.cut_by_bound.add(r.id)
            done += 1
            if progress is not None:
                progress(done, len(requirements), r.id)
    return result
