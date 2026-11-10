"""T11: the report check of the `verified` matcher (T11 note §2, step 5).

For every candidate of a requirement, one model (gpt-5.4) says covered / partial / none, with the
strict meaning of partial agreed on 2026-11-02 (the Gear itself performs a named part of the
outcome; supplying data, a condition, or the same action on another object is none), a quote
from the Gear's card, what the Gear gives and the work left; and whether the requirement is clear
enough to judge. The quote is then checked against the card with T4's evidence rule.

Like the other checks: a `ModelClient`, cached replies, a call bound, one repair, never in CI.
"""

import hashlib
import json
import os
from collections.abc import Sequence
from typing import Literal

from pydantic import ConfigDict, ValidationError

from gears_matcher.judge.llm import CacheError, ModelClient, ResponseCache
from gears_matcher.judge.llm.errors import ClientError
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CheckError, CheckRun
from gears_matcher.models import Frozen, Requirement

__all__ = ["REPORT_PROMPT_HASH", "GearReport", "ReportChecker", "ReportReply", "report_message"]

TIMEOUT_S = 300.0

# The report-check prompt as measured (hash 8563f06bf0934a8d over the prompt and the schema). Do not
# edit without a new measurement: the hash is asserted by the tests.
SYSTEM = (
    "You check candidate Gears for one product requirement and fill a coverage report. "
    "Gears are reusable software components. Use only the requirement text and the Gear "
    "texts shown here.\n"
    'Step 1. Is the requirement clear enough to judge? Answer "clear", or "unclear" when '
    "the text does not say what behaviour is wanted (for example it is only a heading, a "
    "goal with no behaviour, or it contradicts itself). Give a one-line reason. Judge "
    "the Gears in either case.\n"
    "Step 2. Write the requirement's main outcome: what its user or calling product gets "
    "(action + object + result). List its conditions separately: who may do it, sign-in "
    "or permission checks, tenant or organisation scoping, limits, formats.\n"
    "Step 3. For each Gear under CHECK choose exactly one verdict:\n"
    "- covered: the Gear itself performs the whole main outcome on the same kind of "
    "object; only configuration or wiring is left.\n"
    "- partial: the Gear itself performs a clearly named part of the main outcome on the "
    'same kind of object, and product work is left. Name the part it performs in "gives" '
    'and the work left in "left".\n'
    "- none: anything else. Give the kind in none_kind:\n"
    "  condition_only = the Gear would only enforce or supply a condition (sign-in, "
    "permission, tenant scoping, limits) while the outcome is produced elsewhere;\n"
    "  input_only = the Gear only supplies data, a lookup, storage, transport or a "
    "prerequisite step that other logic uses to produce the outcome;\n"
    "  different_object = the Gear does a similar action on a different kind of thing, "
    "or a different action on the same thing;\n"
    "  cannot_tell = the Gear's text is too thin to decide.\n"
    "  If the requirement's main outcome IS such a check, storage or transport (for "
    "example the requirement is about verifying tokens, deciding access, or storing "
    "records), judge it as the outcome.\n"
    "Being useful to the product in general is not enough for partial.\n"
    'Step 4. For covered and partial, copy into "quote" one exact sentence or phrase '
    "from that Gear's text (never from the requirement) that shows the Gear performs "
    "what you claim. Copy it word for word. If no such text exists, choose none with "
    "none_kind cannot_tell.\n"
    "The Gears listed under ALSO PICKED were proposed for the same requirement; they are "
    "context only."
)
SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["clarity", "clarity_reason", "main_outcome", "conditions", "gears"],
    "properties": {
        "clarity": {"enum": ["clear", "unclear"]},
        "clarity_reason": {"type": "string"},
        "main_outcome": {"type": "string"},
        "conditions": {"type": "array", "items": {"type": "string"}},
        "gears": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["gear_id", "verdict", "none_kind", "gives", "left", "quote", "reason"],
                "properties": {
                    "gear_id": {"type": "string"},
                    "verdict": {"enum": ["covered", "partial", "none"]},
                    "none_kind": {
                        "enum": [
                            "",
                            "condition_only",
                            "input_only",
                            "different_object",
                            "cannot_tell",
                        ]
                    },
                    "gives": {"type": "string"},
                    "left": {"type": "string"},
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
    },
}
REPORT_PROMPT_HASH = hashlib.sha256(
    (SYSTEM + json.dumps(SCHEMA, sort_keys=True)).encode()
).hexdigest()[:16]


class GearReport(Frozen):
    model_config = ConfigDict(frozen=True, extra="ignore")

    gear_id: str
    verdict: Literal["covered", "partial", "none"]
    none_kind: Literal["", "condition_only", "input_only", "different_object", "cannot_tell"]
    gives: str
    left: str
    quote: str
    reason: str


class ReportReply(Frozen):
    """The reply the report check must give."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    clarity: Literal["clear", "unclear"]
    clarity_reason: str
    main_outcome: str
    conditions: tuple[str, ...]
    gears: tuple[GearReport, ...]


def report_message(requirement: Requirement, cards: Sequence[GearCard]) -> str:
    """The user message: the requirement and every candidate with its card."""
    blocks = "\n\n".join(f"[{c.gear_id}]\n{c.text}" for c in cards)
    return (
        f"REQUIREMENT\nTitle: {requirement.title}\n{requirement.text}\n\nCHECK\n{blocks}"
        "\n\nALSO PICKED (context only): none"
    )


class ReportChecker:
    """One model running the report check. `identity`: the model and its settings (cache key)."""

    def __init__(
        self, client: ModelClient, cache: ResponseCache, *, identity: str, max_calls: int
    ) -> None:
        if os.environ.get("CI"):
            raise CheckError("the report check never runs in CI (it calls a paid model)")
        if max_calls < 0:
            raise ValueError(f"max_calls must not be negative, got {max_calls}")
        self._client, self._cache, self._identity = client, cache, identity
        self._max_calls = max_calls
        self.run = CheckRun()

    def is_cached(self, requirement: Requirement, cards: Sequence[GearCard]) -> bool:
        return self._cache.path(self._key(report_message(requirement, cards))).is_file()

    def check(self, requirement: Requirement, cards: Sequence[GearCard]) -> ReportReply:
        """The reply, with only the Gears asked about."""
        user = report_message(requirement, cards)
        key = self._key(user)
        entry = self._cache.get(key)
        if entry is not None:
            reply = _parse(entry.reply_text)
            if reply is None:
                raise CheckError(f"cache entry {self._cache.path(key).name} is not a valid report")
            self.run.cache_hits += 1
        else:
            reply = self._ask(key, user)
        asked = {c.gear_id for c in cards}
        return reply.model_copy(
            update={"gears": tuple(g for g in reply.gears if g.gear_id in asked)}
        )

    def _key(self, user: str) -> str:
        parts = json.dumps([self._identity, REPORT_PROMPT_HASH, user], ensure_ascii=False)
        return hashlib.sha256(parts.encode()).hexdigest()

    def _ask(self, key: str, user: str) -> ReportReply:
        tokens = [0, 0]
        text = self._request(user, tokens)
        reply = _parse(text)
        if reply is None:  # one repair
            retry = f"{user}\n\nYour last reply was not valid. Reply with one JSON object only."
            text = self._request(retry, tokens)
            reply = _parse(text)
        if reply is None:
            raise CheckError("the report reply stayed unusable after one repair")
        try:
            self._cache.put(
                key, model=self._identity, prompt_version=REPORT_PROMPT_HASH, reply_text=text,
                tokens=(tokens[0], tokens[1]),
            )  # fmt: skip
        except CacheError as exc:
            self.run.cache_write_errors.append(str(exc)[:300])
        return reply

    def _request(self, user: str, tokens: list[int]) -> str:
        if self.run.calls >= self._max_calls:
            raise CheckError(f"the call bound of {self._max_calls} is reached")
        self.run.calls += 1
        try:
            output = self._client.complete(
                system=SYSTEM, user=user, schema=SCHEMA, timeout_s=TIMEOUT_S
            )
        except ClientError as exc:  # a timeout or provider error: not assessed, never a crash
            raise CheckError(f"the model call failed: {exc}") from exc
        tokens[0] += output.input_tokens
        tokens[1] += output.output_tokens
        self.run.input_tokens += output.input_tokens
        self.run.output_tokens += output.output_tokens
        return output.text


def _parse(text: str) -> ReportReply | None:
    try:
        return ReportReply.model_validate_json(text.strip())
    except ValidationError:
        return None
