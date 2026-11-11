"""T11: a whole `verified` run, from requirements to T5's inputs (T11 note §2, D3-D8).

1. Two models read the whole catalogue, batch by batch (`whole_catalogue`), without the product's
   own Gears: shown, they took the place of the Gears the product is built from (Mini Chat:
   mini-chat was picked, then removed, and chat-engine was never picked). They see `pick_card`:
   every Gear's card also shows what its own PRD says it does (T11 D18, D21).
2. For each requirement, `verified.decide` runs the targeted and strict checks: the build path.
3. The report check (`report_check`) judges every candidate: covered / partial / none, a quote, the
   work left, and whether the requirement is clear.
3b. Main-job check (`main_job`, Opus, T11 D22): a build-list Gear the report check calls partial
   is asked whether its part is the requirement's main job or only a supporting step many features
   need; a supporting Gear leaves the build list and becomes a Gear to confirm.
   The checks of steps 2, 3 and 3b see `check_card`: the Gear's card plus what its own PRD says it
   does (T11 D17) and does not do (T11 D16); the whole-catalogue models of step 1 see `pick_card`.
4. Every candidate becomes a T4 `Match` for T5's `build_report`:
   - a build-path Gear with a covered / partial report and a quote that passes T4's evidence rule is
     covered / partial (the build list, D3);
   - another candidate the report calls covered / partial with a good quote is a Gear to confirm
     (D4): with code first, without code as a future part;
   - every other candidate is none (shown in the requirement's row, not under "also possible");
   - an unclear requirement: every candidate is a Gear to confirm, nothing on the build list.
5. A requirement whose only plausible Gears have no code is a gap with the reason "future part"
   (D5, D8); a requirement a call could not answer is not assessed.

One call budget is shared by every model (`CallBudget`): `--max-calls` bounds the whole run.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from gears_matcher.judge.evidence import evidence_problem
from gears_matcher.judge.llm import ModelClient, ModelOutput
from gears_matcher.judge.models import GearCard
from gears_matcher.judge.seam import gear_card
from gears_matcher.matchers.checks import CheckError, GearChecker
from gears_matcher.matchers.main_job import MainJobChecker
from gears_matcher.matchers.report_check import GearReport, ReportChecker, ReportReply
from gears_matcher.matchers.verified import Decision, decide
from gears_matcher.matchers.whole_catalogue import CatalogueModel, CatalogueModelError, batches
from gears_matcher.models import Gear, Match, Requirement

__all__ = [
    "BudgetSpentError",
    "CallBudget",
    "Counted",
    "RunCancelled",
    "VerifiedResult",
    "check_card",
    "pick_card",
    "pick_cards",
    "run_verified",
    "to_confirm",
]

BUILD_CONFIDENCE = 0.9  # on the build list: both models picked it and two checks confirmed it
CONFIRM_CONFIDENCE = 0.5  # to confirm, with code: the report check called it covered / partial
FUTURE_CONFIDENCE = 0.4  # to confirm, no code yet: a future part
NONE_CONFIDENCE = 0.5
DOES_HEADER = "Does (stated in this Gear's own PRD):"
LIMITS_HEADER = "Does NOT do (stated in this Gear's own PRD):"


def check_card(gear: Gear) -> GearCard:
    """T11 D16, D17: the card the checks see: the plain card, then what the Gear's own PRD says it
    does, then its stated limits."""
    card = gear_card(gear)
    parts = [card.text]
    if gear.does:
        parts += [DOES_HEADER, gear.does]
    if gear.limits:
        parts += [LIMITS_HEADER, gear.limits]
    return card.model_copy(update={"text": "\n".join(parts)})


def pick_card(gear: Gear) -> GearCard:
    """T11 D18, D21: the card the whole-catalogue models see: the plain card, then what the Gear's
    own PRD says it does, so a Gear whose card names few of its features can still be picked
    (mini-chat: web search, file search, model choice). Never its stated limits."""
    card = gear_card(gear)
    if not gear.does:
        return card
    return card.model_copy(update={"text": f"{card.text}\n{DOES_HEADER}\n{gear.does}"})


def pick_cards(cards: Sequence[GearCard], own: frozenset[str]) -> list[GearCard]:
    """The cards the whole-catalogue models see: every card but the product's own Gears."""
    return [c for c in cards if c.gear_id not in own]


def to_confirm(requirement_id: str, gear_id: str, why: str) -> Match:
    """A Gear suggested for a requirement but not confirmed: shown for a person to confirm (D4)."""
    return Match(
        requirement_id=requirement_id,
        gear_id=gear_id,
        verdict="unjudgeable",
        confidence=0.0,
        evidence="",
        rationale=why,
    )


class BudgetSpentError(CatalogueModelError, CheckError):
    """The run's call budget is used up; nothing was sent. Every step reports it as not answered."""


class RunCancelled(Exception):  # noqa: N818 -- reads as the event, like KeyboardInterrupt
    """The caller asked to stop. Raised before a call is sent and between requirements, so calls
    already in flight may still be billed, and the run ends with no report."""


def _never() -> bool:
    return False


@dataclass
class CallBudget:
    """The run's shared budget, and what the service watches: calls and tokens so far, and whether
    the caller asked to stop. `on_call` runs after each call, with this budget."""

    limit: int
    used: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cancelled: Callable[[], bool] = _never
    on_call: Callable[["CallBudget"], None] | None = None


class Counted:
    """A `ModelClient` that spends from a budget shared by every model of the run."""

    def __init__(self, client: ModelClient, budget: CallBudget) -> None:
        self._client, self._budget = client, budget

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        if self._budget.cancelled():
            raise RunCancelled
        if self._budget.used >= self._budget.limit:
            raise BudgetSpentError(f"the call budget of {self._budget.limit} is used up")
        self._budget.used += 1
        out = self._client.complete(system=system, user=user, schema=schema, timeout_s=timeout_s)
        self._budget.input_tokens += out.input_tokens
        self._budget.output_tokens += out.output_tokens
        if self._budget.on_call is not None:
            self._budget.on_call(self._budget)
        return out


@dataclass
class VerifiedResult:
    shortlist: dict[str, list[str]]
    matches: list[Match]
    failed: dict[str, str] = field(default_factory=dict)
    future: dict[str, str] = field(default_factory=dict)
    decisions: dict[str, Decision] = field(default_factory=dict)


@dataclass(frozen=True)
class Models:
    """The run's roles (T11 note D10, D22)."""

    first: CatalogueModel  # Sonnet: candidates
    second: CatalogueModel  # Opus: candidates
    targeted: GearChecker  # Sonnet: plumbing, product-like and broad-Gear checks
    strict: GearChecker  # gpt-5.4: the build-list check
    report: ReportChecker  # gpt-5.4: covered / partial / none, quote, work left, clarity
    main_job: MainJobChecker  # Opus: a partial build-list Gear does the main job or only supports


def run_verified(  # noqa: PLR0913 -- the run's inputs; all but the first three keyword-only
    requirements: Sequence[Requirement],
    cards: Sequence[GearCard],
    models: Models,
    *,
    own: frozenset[str],
    in_code: Callable[[str], bool],
    check_cards: Sequence[GearCard] | None = None,
    cancelled: Callable[[], bool] = _never,
    on_progress: Callable[[int, int], None] | None = None,
) -> VerifiedResult:
    """The whole `verified` run (module docstring). `cards` go to the whole-catalogue models;
    `check_cards` (default: the same cards) to the checks and the report check. `cancelled` is asked
    before each batch and each requirement (`RunCancelled`); `on_progress(done, total)` is called
    after each requirement."""
    by_id = {c.gear_id: c for c in (cards if check_cards is None else check_cards)}
    picks = pick_cards(cards, own)
    result = VerifiedResult(shortlist={r.id: [] for r in requirements}, matches=[])
    done = 0
    for batch in batches(requirements):
        if cancelled():
            raise RunCancelled
        try:
            first = models.first.answer(batch, picks)
            second = models.second.answer(batch, picks)
        except CatalogueModelError as exc:
            for r in batch:
                result.failed[r.id] = (
                    f"the whole-catalogue models could not answer: {str(exc)[:200]}"
                )
            done += len(batch)
            if on_progress is not None:
                on_progress(done, len(requirements))
            continue
        for r in batch:
            if cancelled():
                raise RunCancelled
            d = decide(
                r,
                first=[g for g, _ in first.get(r.id, ())],
                second=[g for g, _ in second.get(r.id, ())],
                own=own,
                in_code=in_code,
                cards=by_id,
                targeted=models.targeted.check,
                strict=models.strict.check,
            )
            result.decisions[r.id] = d
            _report(r, d, by_id, models, in_code, result)
            done += 1
            if on_progress is not None:
                on_progress(done, len(requirements))
    return result


def _report(  # noqa: PLR0913, PLR0917 -- one call site; fills `result` for one requirement
    r: Requirement,
    d: Decision,
    by_id: dict[str, GearCard],
    models: Models,
    in_code: Callable[[str], bool],
    result: VerifiedResult,
) -> None:
    if d.failed:
        result.failed[r.id] = d.failed
        return
    if not d.candidates:
        return
    try:
        reply = models.report.check(r, [by_id[g] for g in d.candidates])
    except CheckError as exc:
        result.failed[r.id] = f"the report check could not be answered: {str(exc)[:200]}"
        return
    reports = {g.gear_id: g for g in reply.gears}
    if reply.clarity != "unclear":
        try:
            _main_job(r, d, by_id, reports, models.main_job)
        except CheckError as exc:
            result.failed[r.id] = f"the main-job check could not be answered: {str(exc)[:200]}"
            return
    result.shortlist[r.id] = list(d.candidates)
    plausible: list[str] = []
    for gid in d.candidates:
        rep = reports.get(gid)
        good = rep is not None and rep.verdict != "none" and _quote_ok(rep, by_id[gid])
        why_none = None if good else _why_none(rep, by_id[gid])
        match = _match(r.id, gid, rep if good else None, d, reply, in_code(gid), why_none)
        result.matches.append(match)
        if good:
            plausible.append(gid)
    if (
        reply.clarity != "unclear"
        and not d.build
        and plausible
        and not any(map(in_code, plausible))
    ):
        names = ", ".join(plausible)
        result.future[r.id] = f"future part: only Gears with no code yet fit ({names})"


def _main_job(
    r: Requirement,
    d: Decision,
    by_id: dict[str, GearCard],
    reports: dict[str, GearReport],
    checker: MainJobChecker,
) -> None:
    """Step 3b (T11 D22): a build-list Gear the report check calls partial, with a good quote, is
    asked whether its part is the main job; a supporting Gear leaves the build list (to confirm)."""
    for gid in list(d.build):
        rep = reports.get(gid)
        if rep is None or rep.verdict != "partial" or not _quote_ok(rep, by_id[gid]):
            continue
        said = checker.check(
            r, by_id[gid], rep.gives or rep.reason, rep.left or "not stated by the check"
        )
        if said.verdict == "supporting":
            d.build.remove(gid)
            d.removed[gid] = (
                f"main-job check: supporting step: {said.reason[:200]} "
                f"(main job: {said.distinctive[:120]})"
            )


def _quote_ok(rep: GearReport, card: GearCard) -> bool:
    return evidence_problem(rep.quote, card.text, card.name) is None


def _why_none(rep: GearReport | None, card: GearCard) -> str:
    """Why a candidate is none (#90 review): the report check left it out of its reply, said none,
    or said covered / partial with a quote that is not in the Gear's card (T4 R1)."""
    if rep is None:
        return "report check: none (the Gear was left out of its reply)"
    if rep.verdict == "none":
        return f"report check: none: {rep.reason[:200]}"
    return f"report check: none (its {rep.verdict} quote is not in the Gear's card)"


def _match(  # noqa: PLR0913, PLR0917 -- one call site; one candidate's Match
    rid: str,
    gid: str,
    rep: GearReport | None,
    d: Decision,
    reply: ReportReply,
    has_code: bool,
    why_none: str | None = None,
) -> Match:
    if reply.clarity == "unclear":
        return to_confirm(rid, gid, f"the requirement is unclear: {reply.clarity_reason[:200]}")
    if rep is not None and gid in d.build:
        verdict = rep.verdict
        return Match(
            requirement_id=rid,
            gear_id=gid,
            verdict=verdict,
            confidence=BUILD_CONFIDENCE,
            evidence=rep.quote,
            covers=rep.gives or rep.reason,
            missing=(rep.left or "not stated by the check") if verdict == "partial" else "",
            rationale=f"picked by both models; strict check: outcome; report check: {rep.reason}",
        )
    if rep is not None:
        if not has_code:
            why = f"future part (no code yet); report check: {rep.verdict}: {rep.reason}"
            return to_confirm(rid, gid, why).model_copy(update={"confidence": FUTURE_CONFIDENCE})
        held = d.removed.get(gid, "picked by one model only" if gid not in d.build else "")
        why = f"not confirmed ({held}); report check: {rep.verdict}: {rep.reason}"
        return to_confirm(rid, gid, why).model_copy(update={"confidence": CONFIRM_CONFIDENCE})
    why = (why_none or "report check: none") + (f" ({d.removed[gid]})" if gid in d.removed else "")
    return Match(
        requirement_id=rid,
        gear_id=gid,
        verdict="none",
        confidence=NONE_CONFIDENCE,
        evidence="",
        rationale=why,
    )
