"""T4b: the records of the real judge (T4b note §4): the model's reply and the run report."""

from typing import Literal, Protocol, Self

from pydantic import ConfigDict, Field, model_validator

from gears_matcher.models import Frozen


class ModelOutput(Frozen):
    """What a `ModelClient` returns for one request."""

    text: str  # the raw reply: a JSON document
    input_tokens: int
    output_tokens: int


class ModelClient(Protocol):
    """The one thing the judge needs from a provider; tests use a fake (D1)."""

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput: ...


class ReplyItem(Frozen):
    """One candidate's judgement, as the model must give it. Validated one item at a time (D7)."""

    model_config = ConfigDict(extra="forbid")

    gear_id: str
    verdict: Literal["covered", "partial", "none", "unjudgeable"]
    confidence: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    # Only the verdict, its confidence and the gear are always required. A model that cannot be
    # forced to a schema often leaves an empty text field out (for a `none`) or forgets one; the
    # seam's rules (R1, R6, R8) say what each verdict needs, so an omission is judged there, with
    # its reason, instead of throwing the item (or the whole reply) away here. The exception is a
    # `covered` or `partial` item without its text (below): it is not valid, so a reply made only of
    # such items is repaired once and never cached, instead of being cached and rejected by the seam
    # on every rerun.
    evidence: str = ""  # a quote from the gear's card; checked later by T4's R1
    covers: str = ""
    missing: str = ""
    rationale: str = ""

    @model_validator(mode="after")
    def _a_match_names_its_text(self) -> Self:
        needs = {"covered": ("evidence", "covers"), "partial": ("evidence", "covers", "missing")}
        absent = [n for n in needs.get(self.verdict, ()) if not getattr(self, n).strip()]
        if absent:
            raise ValueError(f"a {self.verdict} item needs {', '.join(absent)}")
        return self


class ModelReply(Frozen):
    """The whole reply. Its JSON schema is what the model must follow, and is in the cache key."""

    judgements: tuple[ReplyItem, ...]


class RejectedItem(Frozen):
    """An item dropped before the seam saw it (D7): the gear reads as `no_reply` on its match."""

    requirement_id: str
    gear_id: str
    reason: str


class UncachedReply(Frozen):
    """A reply used for this run but not saved because it did not answer the candidates (D7)."""

    requirement_id: str
    reason: str


class JudgeUsage(Frozen):
    """The run report (D14). `calls` counts requests sent to the provider, cache hits apart."""

    model: str
    prompt_version: str
    calls: int = 0
    cache_hits: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0  # what the replies served from the cache cost to produce
    cached_output_tokens: int = 0
    budget_hit: bool = False
    rejected_items: tuple[RejectedItem, ...] = ()
    cache_write_errors: tuple[str, ...] = ()  # replies used but not saved: asked again next run
    uncached_replies: tuple[UncachedReply, ...] = ()  # replies that missed candidates: asked again
