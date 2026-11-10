"""T4: the match judge seam. Every semantic judgement passes here (T4 note §1, §4, §6).

`judge_requirement` calls a `MatchJudge` for one requirement and its candidate gears, under a
deadline, and applies rules R1-R8 to whatever comes back. It returns exactly one `Match` per gear,
in gear-id order, whatever the judge does: a judge's failure is recorded on the match (`problem`),
never raised. Only a caller's own mistake (duplicate gears, a card for another gear, a bad deadline)
raises `ValueError`.
"""

import math
import threading
import unicodedata
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, get_args

from pydantic import ValidationError

from gears_matcher.judge.evidence import evidence_problem
from gears_matcher.judge.models import GearCard, JudgeReply
from gears_matcher.models import Gear, JudgeProblem, Match, ProblemKind, Requirement, Verdict

DEFAULT_DEADLINE_S = 120.0
DETAIL_LIMIT = 300  # a problem's detail is shown to people: bounded, control characters removed

_VERDICT_OF: dict[str, Verdict] = {v: v for v in get_args(Verdict)}


@dataclass(frozen=True)
class _Failed:
    """The seam's own record of a failed call, kept apart from anything a judge returns."""

    problem: JudgeProblem


class BudgetExceeded(Exception):  # noqa: N818 -- the name a judge's author will look for
    """Raised by a judge that has hit its own call bound; recorded as `budget_exceeded` (R4).

    Like any exception a judge raises, its text is copied into `JudgeProblem.detail`: a judge must
    never put a key or a request header in an exception message (R4).
    """


class MatchJudge(Protocol):
    """Any judge: the stub, a test double, T4b's model. One reply per card (D2)."""

    def judge(
        self, requirement: Requirement, cards: Sequence[GearCard]
    ) -> Sequence[JudgeReply]: ...


@dataclass(frozen=True)
class PairJudge:
    """Adapts a one-pair function to `MatchJudge` (D2): one call per card, in card order."""

    judge_pair: Callable[[Requirement, GearCard], JudgeReply]

    def judge(self, requirement: Requirement, cards: Sequence[GearCard]) -> Sequence[JudgeReply]:
        return tuple(self.judge_pair(requirement, card) for card in cards)


def gear_card(gear: Gear) -> GearCard:
    """The default card (D3): the text T3 searches, one field per line.

    Name, responsibility, capabilities and the `gear.gdl` description, which counts once when it
    repeats the responsibility, as in `retrieval.gear_text`: the judge sees every word T3 matched.
    """
    fields = [gear.name, gear.responsibility, *gear.capabilities]
    if gear.description and gear.description != gear.responsibility:
        fields.append(gear.description)
    lines = (line.strip() for line in fields)
    return GearCard(gear_id=gear.id, name=gear.name, text="\n".join(line for line in lines if line))


def judge_requirement(
    judge: MatchJudge,
    requirement: Requirement,
    gears: Sequence[Gear],
    *,
    deadline_s: float = DEFAULT_DEADLINE_S,
    card: Callable[[Gear], GearCard] = gear_card,
) -> tuple[Match, ...]:
    """Judge one requirement against its candidate gears: one `Match` per gear, in gear-id order."""
    if not (math.isfinite(deadline_s) and deadline_s > 0):
        raise ValueError(f"deadline_s must be a positive number of seconds, got {deadline_s!r}")
    ordered = sorted(gears, key=lambda gear: gear.id)
    duplicates = sorted(gid for gid, n in Counter(g.id for g in ordered).items() if n > 1)
    if duplicates:
        raise ValueError(f"duplicate candidate gear ids: {', '.join(duplicates)}")
    if not ordered:
        return ()  # D6: no candidates, no call
    cards = tuple(card(gear) for gear in ordered)
    for gear, built in zip(ordered, cards, strict=True):
        if built.gear_id != gear.id:
            raise ValueError(f"the card for {gear.id} names {built.gear_id}")
    outcome = _call(judge, requirement, cards, deadline_s)
    if isinstance(outcome, JudgeProblem):
        return tuple(_problem_match(requirement, gear.id, outcome) for gear in ordered)
    return _check_replies(requirement, cards, outcome)


def _call(
    judge: MatchJudge, requirement: Requirement, cards: tuple[GearCard, ...], deadline_s: float
) -> tuple[JudgeReply, ...] | JudgeProblem:
    """R4, R5: run the judge on a daemon thread, so neither an error nor a hang stops the run."""
    box: list[_Failed | object] = []

    def run() -> None:
        try:
            box.append(judge.judge(requirement, cards))
        except BudgetExceeded as exc:  # R4: the run hit the judge's call bound
            box.append(_Failed(_problem("budget_exceeded", str(exc) or "the call bound was hit")))
        except Exception as exc:  # R4: any judge failure is recorded, never raised
            box.append(_Failed(_problem("judge_error", f"{type(exc).__name__}: {exc}")))

    thread = threading.Thread(target=run, name=f"judge {requirement.id}", daemon=True)
    thread.start()
    thread.join(deadline_s)
    if thread.is_alive():
        return _problem("judge_timeout", f"no reply within {deadline_s:g} s")
    if not box:
        return _problem("judge_error", "the judge stopped without a reply or an exception")
    value = box[0]
    if isinstance(value, _Failed):  # only the seam makes these; a judge's return is never trusted
        return value.problem
    return _as_replies(value)


def _as_replies(value: object) -> tuple[JudgeReply, ...] | JudgeProblem:
    """The judge returned a sequence of well-formed `JudgeReply`, or the whole call is invalid."""
    if isinstance(value, str | bytes) or not isinstance(value, Sequence):
        return _problem("invalid_reply", f"the judge returned {type(value).__name__}, not replies")
    replies: list[JudgeReply] = []
    for item in value:
        if not isinstance(item, JudgeReply):
            return _problem(
                "invalid_reply", f"a reply is a {type(item).__name__}, not a JudgeReply"
            )
        try:  # a reply built with `model_construct` skipped validation: validate it here
            replies.append(JudgeReply.model_validate(item.model_dump(warnings=False)))
        except ValidationError as exc:
            return _problem("invalid_reply", f"malformed reply: {exc.errors()[0]['msg']}")
    return tuple(replies)


def _check_replies(
    requirement: Requirement, cards: tuple[GearCard, ...], replies: tuple[JudgeReply, ...]
) -> tuple[Match, ...]:
    """R3: one reply per candidate, and only for candidates; then R1, R2, R6 per reply."""
    by_gear: dict[str, list[JudgeReply]] = {card.gear_id: [] for card in cards}
    stray = sorted({reply.gear_id for reply in replies} - by_gear.keys())
    if stray:  # the judge lost track of the question: nothing it said about this requirement holds
        problem = _problem("invalid_reply", f"a reply for a non-candidate gear: {', '.join(stray)}")
        return tuple(_problem_match(requirement, card.gear_id, problem) for card in cards)
    for reply in replies:
        by_gear[reply.gear_id].append(reply)
    return tuple(_one(requirement, card, by_gear[card.gear_id]) for card in cards)


def _one(requirement: Requirement, card: GearCard, replies: list[JudgeReply]) -> Match:
    if not replies:
        return _problem_match(
            requirement, card.gear_id, _problem("no_reply", "the judge gave no reply for this gear")
        )
    if len(replies) > 1:
        problem = _problem("invalid_reply", f"{len(replies)} replies for this gear")
        return _problem_match(requirement, card.gear_id, problem)
    return _check(requirement, card, replies[0])


def _check(requirement: Requirement, card: GearCard, reply: JudgeReply) -> Match:
    rationale = reply.rationale.strip()
    verdict = _VERDICT_OF.get(reply.verdict)
    if verdict is None:  # R2
        problem = _problem("invalid_reply", f"unknown verdict {reply.verdict!r}")
        return _problem_match(requirement, card.gear_id, problem, rationale)
    if not (math.isfinite(reply.confidence) and 0.0 <= reply.confidence <= 1.0):  # R2
        problem = _problem("invalid_reply", f"confidence {reply.confidence!r} is not in 0..1")
        return _problem_match(requirement, card.gear_id, problem, rationale)
    evidence = covers = missing = ""
    if verdict in ("covered", "partial"):  # R1, R7
        why = evidence_problem(reply.evidence, card.text, card.name)
        if why is not None:
            problem = _problem("evidence_not_found", f"{why}: {reply.evidence!r}")
            return _problem_match(requirement, card.gear_id, problem, rationale)
        evidence, covers, missing = (
            reply.evidence.strip(),
            reply.covers.strip(),
            reply.missing.strip(),
        )
        lacking = _r8_lacking(verdict, covers, missing)
        if lacking:  # R8: a match says what the gear covers, and a partial what is left
            problem = _problem("invalid_reply", f"{verdict} without saying {lacking}")
            return _problem_match(requirement, card.gear_id, problem, rationale)
    elif verdict == "unjudgeable" and not rationale:  # R6: a "can't tell" must say why
        problem = _problem("invalid_reply", "unjudgeable without a rationale")
        return _problem_match(requirement, card.gear_id, problem)
    return Match(
        requirement_id=requirement.id,
        gear_id=card.gear_id,
        verdict=verdict,
        confidence=reply.confidence,
        evidence=evidence,
        covers=covers,
        missing=missing,
        rationale=rationale,
    )


def _r8_lacking(verdict: str, covers: str, missing: str) -> str:
    if not covers:
        return "what the gear covers"
    if verdict == "partial" and not missing:
        return "what is missing"
    return ""


def _problem(kind: ProblemKind, detail: str) -> JudgeProblem:
    return JudgeProblem(kind=kind, detail=_clean(detail))


def _problem_match(
    requirement: Requirement, gear_id: str, problem: JudgeProblem, rationale: str = ""
) -> Match:
    return Match(
        requirement_id=requirement.id,
        gear_id=gear_id,
        verdict="unjudgeable",
        confidence=0.0,
        evidence="",
        rationale=rationale,
        problem=problem,
    )


def _clean(text: str) -> str:
    """Control characters to spaces, whitespace collapsed, at most `DETAIL_LIMIT` characters."""
    plain = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in text)
    plain = " ".join(plain.split())
    return plain if len(plain) <= DETAIL_LIMIT else plain[: DETAIL_LIMIT - 1] + "…"
