"""Shared records: frozen pydantic models. Later tasks add reports.

Both parsers: `Issue`. T1 (catalogue): `SourceRef`, `Plugin`, `Gear`. T2 (spec): `SpecRef`,
`Requirement`. T4 (judge): `JudgeProblem`, `Match`. A requirement's
position is a `SpecRef`, not a `SourceRef`: a catalogue reference never describes a spec position.
"""

from typing import Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)

SOURCE_NAME = "gears-rust"

MustLevel = Literal["MUST", "MUST NOT", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "MAY"]


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class Issue(Frozen):
    """One parse-report finding: `error` means something is wrong, `info` is a fact to know."""

    severity: Literal["error", "info"]
    kind: str
    message: str
    where: str | None = None


class SourceRef(Frozen):
    """Where a fact came from: file and 1-based line, in one of the two sources."""

    kind: Literal["gears-md", "gear-gdl"]
    path: str
    line: int


class Plugin(Frozen):
    """A `gear.gdl` under `plugins/`. Attached to its parent gear; never a gear itself."""

    name: str
    crate: str | None
    implements: str | None
    path: str


class Gear(Frozen):
    id: str  # `<source>/<gear_id>`, e.g. `gears-rust/credstore`
    name: str
    category: str | None
    responsibility: str
    description: str | None = None  # the `gear.gdl` description, verbatim; None without a gear.gdl
    capabilities: tuple[str, ...] = ()
    crate: str | None = None
    plugins: tuple[Plugin, ...] = ()
    doc_paths: tuple[str, ...] = ()
    limits: str | None = None  # T11 D16: what its own docs/PRD.md says it does not do; None: none
    does: str | None = None  # T11 D17: what its own docs/PRD.md says it does; None: none
    sources: tuple[SourceRef, ...]


class SpecRef(Frozen):
    """Where a requirement is defined: spec file, 1-based line of its ID, and its heading path."""

    path: str
    line: int
    heading: str | None = None  # e.g. `5. Functional Requirements > 5.3 Connections > Durable`
    end_line: int | None = None  # last line of the passage (T8); None for a CF requirement (T2)

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> Self:
        if self.end_line is not None and self.end_line < self.line:
            raise ValueError(f"end_line {self.end_line} is before line {self.line}")
        return self

    @model_serializer(mode="wrap")
    def _omit_unset_end(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """A dump leaves `end_line` out while it is None, so a CF spec's JSON is what it was before
        T8 added the field (T8 note §3)."""
        data: dict[str, Any] = handler(self)
        if self.end_line is None:
            data.pop("end_line", None)
        return data


class Requirement(Frozen):
    """One CF requirement from a spec: the left-hand side of every match."""

    id: str  # the spec's own ID, verbatim: `cpt-studio-fr-connections`
    title: str  # the nearest heading above the ID line
    text: str  # the statement, verbatim except hard-wrap joining
    kind: Literal["fr", "nfr"]
    must_level: MustLevel | None  # the first MUST/SHALL/SHOULD/MAY in the text; None if none
    priority: str | None  # the spec's own `p1`: metadata only, never used for matching
    planned: bool  # the text starts with `Planned.`
    source: SpecRef
    origin: Literal["template", "extracted"] = "template"  # `extracted`: read by T8's model

    @model_serializer(mode="wrap")
    def _omit_template_origin(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """As `SpecRef`: a CF requirement's dump has no `origin` (T8 note §3)."""
        data: dict[str, Any] = handler(self)
        if self.origin == "template":
            data.pop("origin", None)
        return data


class Clarification(Frozen):
    """A topic to ask the spec's author about (#65, T8 note D11): too vague, or missing.

    The model's words: bounded, and shown escaped. `quote` is a passage of the spec, verified in
    the document when given; None means an absence ("nothing says how users sign in").
    """

    topic: str
    reason: str
    quote: str | None
    path: str  # the document it was found in


Verdict = Literal["covered", "partial", "none", "unjudgeable"]
ProblemKind = Literal[
    "evidence_not_found",
    "invalid_reply",
    "no_reply",
    "judge_error",
    "judge_timeout",
    "budget_exceeded",
]


class JudgeProblem(Frozen):
    """Why the seam, not the judge, decided a verdict (T4 note, D1)."""

    kind: ProblemKind
    detail: str


class Match(Frozen):
    """One (requirement, gear) verdict, after the seam's rules (T4 note §4)."""

    requirement_id: str
    gear_id: str
    verdict: Verdict
    # how sure the judge is of *this verdict* (a `none` can be 0.9); 0 when the seam decided
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: str  # a quote verified in the gear's card text; "" unless covered / partial
    covers: str = ""  # what the gear provides for this requirement; set for covered / partial
    missing: str = ""  # what the product still has to build; set for partial (R8)
    rationale: str
    problem: JudgeProblem | None = None  # set only when the seam overrode or replaced the judge

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.verdict in ("covered", "partial") and not self.evidence:
            raise ValueError(f"a {self.verdict} match needs evidence")
        if self.verdict in ("none", "unjudgeable") and (
            self.evidence or self.covers or self.missing
        ):
            raise ValueError(f"a {self.verdict} match carries no evidence, covers or missing")
        if self.verdict in ("covered", "partial") and not self.covers:
            raise ValueError(f"a {self.verdict} match says what the gear covers")
        if self.verdict == "partial" and not self.missing:
            raise ValueError("a partial match says what is missing")
        if self.problem is not None and (self.verdict != "unjudgeable" or self.confidence != 0.0):
            raise ValueError("a judge problem makes the match unjudgeable with confidence 0")
        return self
