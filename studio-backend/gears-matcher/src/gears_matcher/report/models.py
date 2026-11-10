"""T5 records: the coverage report for one spec (T5 note §3)."""

from typing import Literal, Self

from pydantic import Field, model_validator

from gears_matcher.models import Clarification, Frozen, JudgeProblem, Verdict
from gears_matcher.spec.models import InputDoc

SCHEMA_VERSION = "1.2.0"  # semver: a new optional field is minor; a removed or renamed one, major
DEFAULT_TAU = 0.5  # a placeholder until T10 calibrates it (D4)

Coverage = Literal["covered", "partial", "gap", "clarification_needed", "not_assessed"]
Role = Literal["chosen", "alternative", "other"]


class GearMatch(Frozen):
    """One gear's verdict for one requirement, as the report shows it."""

    gear_id: str
    verdict: Verdict
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str  # quoted from the gear's own text (T4 R1)
    covers: str  # what this gear provides for the requirement (T4 R8)
    missing: str  # what is left if this gear is used (T4 R8)
    rationale: str
    problem: JudgeProblem | None = None
    role: Role  # D3: the chosen gear, another gear that helps, or neither


class RequirementCoverage(Frozen):
    requirement_id: str
    kind: Literal["fr", "nfr"]
    planned: bool  # D10: reported like the others, flagged
    extracted: bool = (
        False  # chosen by T8's model from free-form text, not read from a CF ID (1.1.0)
    )
    coverage: Coverage
    confidence: float | None  # the chosen match's confidence; None without a chosen gear
    low_confidence: bool  # covered/partial, but the chosen match is below tau (D4)
    reason: str  # why this coverage, in one line
    gear_provides: str  # the chosen gear's `covers`; "" without a chosen gear (D9)
    remaining_work: str  # the chosen gear's `missing`: always for partial, maybe for covered (D9)
    gears: tuple[
        GearMatch, ...
    ]  # chosen, then alternatives, then the rest; each by confidence (D12)


class GearUse(Frozen):
    gear_id: str
    name: str
    confidence: float = Field(ge=0.0, le=1.0)  # D5: the maximum over requirement_ids
    in_code: bool  # has a gear.gdl (T11 verified: declares a crate); False: no code yet
    requirement_ids: tuple[str, ...]  # recommended: where chosen; also possible: where it helps


class CoverageCounts(Frozen):
    covered: int = 0
    partial: int = 0
    gap: int = 0
    clarification_needed: int = 0
    not_assessed: int = 0

    def total(self) -> int:
        return (
            self.covered + self.partial + self.gap + self.clarification_needed + self.not_assessed
        )


class Totals(Frozen):
    """D8: every requirement is counted once, FR and NFR apart."""

    requirements: int
    fr: CoverageCounts
    nfr: CoverageCounts


class RunSettings(Frozen):
    """What the caller ran with; recorded, not interpreted."""

    judge: str  # e.g. "StubJudge"
    shortlist: str  # e.g. "tf-idf, k=10"
    tau: float = Field(default=DEFAULT_TAU, ge=0.0, le=1.0)
    extraction: str | None = None  # e.g. "llm: claude-sonnet-4-6, prompt v0"; None: not used


class Provenance(Frozen):
    product_id: str
    spec_repository: str | None
    spec_commit: str | None
    gears_md_commit: str | None
    gear_gdl_commit: str | None
    judge: str
    shortlist: str
    tau: float
    extraction: str | None = None  # how free-form requirements were read, if they were (1.1.0)


class CoverageReport(Frozen):
    schema_version: str
    provenance: Provenance
    recommended_gears: tuple[GearUse, ...]  # D3: chosen somewhere at confidence >= tau
    also_possible: tuple[GearUse, ...]  # D3: every other gear that helps (with code, T11 D19)
    future_parts: tuple[GearUse, ...] = ()  # T11 D15: helping Gears, no code (1.2.0)
    requirements: tuple[RequirementCoverage, ...]  # every requirement, in spec order
    totals: Totals
    inputs: tuple[InputDoc, ...]  # T2's: documents read, handed to T8, or skipped, and why
    clarifications: tuple[Clarification, ...] = ()  # #65: topics to ask the author (1.1.0)

    @model_validator(mode="after")
    def _totals_add_up(self) -> Self:
        counted = {"fr": CoverageCounts(), "nfr": CoverageCounts()}
        for r in self.requirements:
            old = counted[r.kind]
            counted[r.kind] = old.model_copy(update={r.coverage: getattr(old, r.coverage) + 1})
        expected = Totals(requirements=len(self.requirements), **counted)
        if self.totals != expected:
            raise ValueError(f"totals {self.totals} do not match the requirements {expected}")
        return self

    def gaps(self) -> tuple[str, ...]:
        return tuple(r.requirement_id for r in self.requirements if r.coverage == "gap")

    def clarification_needed(self) -> tuple[str, ...]:
        return tuple(
            r.requirement_id for r in self.requirements if r.coverage == "clarification_needed"
        )
