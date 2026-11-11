"""T3 records: a ranked candidate, a per-requirement shortlist, and the errors that stop a call."""

from typing import Literal, Protocol

from gears_matcher.models import Frozen

__all__ = ["Candidate", "RequirementLike", "RetrievalError", "Shortlist"]


class RequirementLike(Protocol):
    """What T3 reads from a requirement (T2's `Requirement` has these). Nothing else is read."""

    @property
    def id(self) -> str: ...
    @property
    def title(self) -> str: ...
    @property
    def text(self) -> str: ...


class Candidate(Frozen):
    gear_id: str
    score: float  # cosine similarity in (0, 1], rounded to 9 places


class Shortlist(Frozen):
    """The candidates for one requirement, best first.

    `status` says why there may be none, so a failure never looks like "no gear matches":
    `empty_query` (blank title and text) and `no_overlap` (no token in common with any gear) are
    findings to report. A requirement with fewer than `k` matching gears gets fewer than `k`.
    `k` is what the shortlist was retrieved with: recall can only be asked up to it.
    """

    requirement_id: str
    status: Literal["ok", "no_overlap", "empty_query"]
    k: int
    candidates: tuple[Candidate, ...]

    @property
    def gear_ids(self) -> tuple[str, ...]:
        return tuple(c.gear_id for c in self.candidates)


class RetrievalError(ValueError):
    """The call cannot be answered at all. `kind` is stable: callers and tests match on it."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(f"{kind}: {message}")
        self.kind = kind
