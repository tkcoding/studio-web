"""The seam's own records: what a judge is shown and what it returns (T4 note §3)."""

from gears_matcher.models import Frozen


class GearCard(Frozen):
    """Exactly what the judge is shown for one gear; evidence is checked against `text`."""

    gear_id: str
    name: str  # a quote that is only this name proves nothing (R1)
    text: str  # built by the seam (default: T3's search text; D3)


class JudgeReply(Frozen):
    """What a judge returns for one gear. Untrusted: the seam checks every field."""

    gear_id: str
    verdict: str  # str, not Verdict: an unknown value is a problem to record, not a crash
    confidence: float
    evidence: str = ""  # a quote from that gear's card text
    covers: str = ""  # covered / partial: what the gear provides for this requirement (R8)
    missing: str = ""  # partial: what the product still has to build (R8)
    rationale: str = ""
