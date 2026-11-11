"""`StubJudge`: a deterministic judge for tests and CI (T4 note D7). A wiring aid, not a judgement.

It scores word overlap, so it exercises every verdict the same way on every run and calls no
service. Its thresholds are not tuned, and nothing is scored on the stub alone.
"""

import re
import unicodedata
from collections.abc import Sequence

from gears_matcher.judge.evidence import MIN_WORDS, normalise, word_count
from gears_matcher.judge.models import GearCard, JudgeReply
from gears_matcher.models import Requirement

COVERED_SHARE = 0.5
PARTIAL_SHARE = 0.25
MIN_CONTENT_WORDS = 3

# Function words and modal verbs only (MUST, SHALL, ...), the same rule as T3's stop words, written
# here because T4 does not depend on T3. Content words ("system", "user") stay: they name what
# gears do.
_FUNCTION_WORDS_TEXT = """
    a about after all also an and any are as at be been before being between both but by can
    could did do does each either for from had has have how if in into is it its may might must
    no nor not of on only or other our out over own per same shall should so such than that the
    their them then there these they this those through to under until up upon via was we were
    what when where which while who will with within without would you your
"""
FUNCTION_WORDS = frozenset(_FUNCTION_WORDS_TEXT.split())

_WORD = re.compile(r"[^\W_]+")


def content_words(text: str) -> frozenset[str]:
    """Lower-case words with accents folded, function words and single letters dropped."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    folded = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return frozenset(w for w in _WORD.findall(folded) if len(w) > 1 and w not in FUNCTION_WORDS)


class StubJudge:
    """Share of the requirement's content words found in the card decides the verdict."""

    def judge(self, requirement: Requirement, cards: Sequence[GearCard]) -> Sequence[JudgeReply]:
        wanted = content_words(f"{requirement.title} {requirement.text}")
        if len(wanted) < MIN_CONTENT_WORDS:
            reason = f"too short to judge: {len(wanted)} content words (fewer than 3)"
            return tuple(
                JudgeReply(
                    gear_id=c.gear_id, verdict="unjudgeable", confidence=0.0, rationale=reason
                )
                for c in cards
            )
        return tuple(_reply(wanted, card) for card in cards)


def _reply(wanted: frozenset[str], card: GearCard) -> JudgeReply:
    found = wanted & content_words(card.text)
    share = len(found) / len(wanted)
    rationale = f"{share:.2f} of the requirement's {len(wanted)} content words are in the card"
    line = _best_line(wanted, card)
    if share >= COVERED_SHARE and line:
        verdict = "covered"
    elif share >= PARTIAL_SHARE and line:
        verdict = "partial"
    else:
        return JudgeReply(
            gear_id=card.gear_id, verdict="none", confidence=share, rationale=rationale
        )
    # R8: what the gear covers is the quoted line; what is missing, the words the card lacks
    absent = sorted(wanted - found)
    missing = f"not in the card: {', '.join(absent)}" if absent else ""
    return JudgeReply(
        gear_id=card.gear_id,
        verdict=verdict,
        confidence=share,
        evidence=line,
        covers=line,
        missing=missing if verdict == "partial" else "",
        rationale=rationale,
    )


def _best_line(wanted: frozenset[str], card: GearCard) -> str:
    """The card line sharing the most words with the requirement that also passes R1, or ""."""
    best, best_overlap = "", 0
    name = normalise(card.name)
    for line in card.text.splitlines():
        text = line.strip()
        if word_count(text) < MIN_WORDS or normalise(text) == name:
            continue
        overlap = len(wanted & content_words(text))
        if overlap > best_overlap:  # strict: the first line wins a tie
            best, best_overlap = text, overlap
    return best
