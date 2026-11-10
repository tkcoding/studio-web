"""T8 records (T8 note §3): what the extractor returns, and the reply the model must give.

`Extraction.outcomes` is the per-document row. The note puts these counts on `InputDoc` for the
coverage report; that field comes with the report's schema change (T8 PR 4, with #65), so until
then they live in `DocumentOutcome`.
"""

from typing import Literal

from pydantic import ConfigDict, Field

from gears_matcher.models import Clarification, Frozen, Issue, Requirement
from gears_matcher.spec.models import DocumentExtraction

__all__ = [
    "EXTRACT_SCHEMA_VERSION",
    "Clarification",
    "DocumentOutcome",
    "Dropped",
    "ExtractItem",
    "ExtractReply",
    "Extracted",
    "Extraction",
    "ExtractionReport",
    "Span",
    "UnclearItem",
]

EXTRACT_SCHEMA_VERSION = "1.1.0"  # semver: a new optional field is minor, a removed one major


class Span(Frozen):
    """Where in a document: character offsets into `Document.text`, end exclusive."""

    path: str
    start: int
    end: int


class Extracted(Frozen):
    requirement: Requirement  # origin = "extracted"; `kind` is the model's, the rest is code's
    span: Span  # the block `requirement.text` was cut from
    quote: str  # what the model quoted: bounded, shown escaped
    spec_id: str | None  # the spec's own ID, when it passed D5's rule
    names_gear: tuple[str, ...]  # full `Gear.id`s found in the span (D7)


class Dropped(Frozen):
    """A model item thrown away, with why. `item` is cut to 200 characters and shown escaped."""

    path: str
    kind: str  # `quote`, `item`, `clarification`
    reason: str
    item: str


class DocumentOutcome(DocumentExtraction):
    """`DocumentExtraction` for one document, with what only the review sheet shows."""

    path: str
    unclaimed_examples: tuple[str, ...] = ()  # the first ten, cut to 200 characters (review sheet)
    sha256: str | None = None  # of the text the spans index into: a changed document shifts them

    def counts(self) -> DocumentExtraction:
        """The part that goes into the coverage report: no spec text."""
        return DocumentExtraction.model_validate(
            self.model_dump(exclude={"path", "unclaimed_examples", "sha256"})
        )


class ExtractionReport(Frozen):
    model: str
    prompt_version: str
    chunks: int
    chunks_failed: int
    cache_hits: int
    calls: int
    input_tokens: int
    output_tokens: int
    dropped: tuple[Dropped, ...]  # at most 100 kept; `dropped_total` counts them all
    dropped_total: int
    unclaimed_blocks: int
    issues: tuple[Issue, ...] = ()

    @property
    def errors(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.severity == "error")


class Extraction(Frozen):
    schema_version: str = EXTRACT_SCHEMA_VERSION
    product_id: str | None = None  # the spec the documents belong to
    gears_md_commit: str | None = None  # the catalogue `names_gear` was tagged against, if given
    gear_gdl_commit: str | None = None
    extracted: tuple[Extracted, ...]  # sorted by (path, offset)
    clarifications: tuple[Clarification, ...]
    outcomes: tuple[DocumentOutcome, ...]
    report: ExtractionReport

    @property
    def incomplete(self) -> bool:
        return any(o.incomplete for o in self.outcomes)

    @property
    def nothing_extracted(self) -> bool:
        """Never read as "no requirements": the run is not usable (T2 D8's rule, D15)."""
        return not self.extracted


# --- the model's reply -------------------------------------------------------------------------


class ExtractItem(Frozen):
    model_config = ConfigDict(extra="forbid", frozen=True)

    quote: str
    kind: Literal["fr", "nfr"]
    id: str | None = None
    # the last words of a statement that runs over several blocks; none means `quote` is it all
    end_quote: str | None = None


class UnclearItem(Frozen):
    model_config = ConfigDict(extra="forbid", frozen=True)

    topic: str
    reason: str
    quote: str | None = None


class ExtractReply(Frozen):
    """The whole reply; its JSON schema is what the model must follow, and is in the cache key.

    Items are validated one at a time by the extractor (a bad item is dropped and counted, never
    the whole reply); this model is the shape the schema describes.
    """

    items: tuple[ExtractItem, ...] = Field(default=())
    unclear: tuple[UnclearItem, ...] = Field(default=())
