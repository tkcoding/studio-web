"""Spec-only records: the inputs report, the parse report and the spec.

`Requirement` and `Issue` (shared with T1's parse report) are in `models`.
"""

from typing import Literal

from gears_matcher.models import Frozen, Issue, Requirement

__all__ = [
    "Document",
    "DocumentExtraction",
    "InputDoc",
    "Issue",
    "LoadedSpec",
    "Spec",
    "SpecReport",
]

InputStatus = Literal["read", "handed-to-t8", "skipped"]


class DocumentExtraction(Frozen):
    """What T8 did with a document it was handed (T8 note D12): counted, so nothing is lost
    silently. `incomplete` means a chunk could not be read, nothing came out of a document that
    holds requirement-like text, or too many blocks with MUST/SHALL/SHOULD/MAY were left (D10)."""

    kept: int
    dropped: int  # model items thrown away (a quote not in the document, a bad item, ...)
    merged: int  # quotes that fell in a block already kept
    shaped_blocks: int  # requirement-like blocks: broad, informational
    unclaimed_blocks: int
    strong_blocks: int  # blocks with MUST/SHALL/SHOULD/MAY in capitals, or a user story
    unclaimed_strong: int  # of those, in no requirement: this one gates
    chunks: int
    chunks_failed: int
    incomplete: bool
    reason: str  # why it is incomplete; "" when it is not


class InputDoc(Frozen):
    """One document of the bundle, and what T2 (and T8, if it was handed over) did with it."""

    path: str
    status: InputStatus
    requirements: int  # how many this document gave: T2's, or T8's when `extraction` is set
    reason: str
    extraction: DocumentExtraction | None = None  # set only for a document T8 read (minor, 1.1.0)


class SpecReport(Frozen):
    requirements: int
    fr: int
    nfr: int
    no_must_level: int  # requirements with no MUST/SHALL/SHOULD/MAY (house style, not vagueness)
    planned: int
    read: int  # documents read
    handed_to_t8: int
    skipped: int
    issues: tuple[Issue, ...] = ()

    @property
    def errors(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.severity == "error")


class Spec(Frozen):
    product_id: str  # `constructor-studio`
    name: str
    repository: str | None  # `constructorfabric/studio-web`
    commit: str | None  # the spec snapshot; None for a single file
    requirements: tuple[Requirement, ...]
    inputs: tuple[InputDoc, ...]  # every document: read / handed to T8 / skipped, and why
    report: SpecReport


class Document(Frozen):
    """A document T2 hands to T8, with the text T2 verified: the SHA-256, size, path and encoding
    checks are done, and the byte-order mark is removed. T8's character offsets are offsets into
    `text`, so nothing re-reads the file after the check (T8 note §4.1)."""

    path: str  # as in `InputDoc.path`
    text: str


class LoadedSpec(Frozen):
    """`load_documents`: the spec as `load_spec` reads it, plus the documents handed to T8."""

    spec: Spec  # `requirements` may be empty: a free-form spec has no CF requirement
    handed: tuple[Document, ...]  # the `handed-to-t8` documents that passed every check, by path
