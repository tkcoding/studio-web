"""T11: the one-Gear checks of the `verified` matcher (T11 note §2, steps 2-4).

A check asks one question per Gear: does this Gear itself perform the requirement's main outcome, or
only enforce a condition, supply an input, or act on another kind of object? Only "outcome" lets a
Gear stay on the way to the build list. The same prompt serves the targeted checks (Sonnet) and the
strict check (gpt-5.4); its hash is recorded in the report.

Like the whole-catalogue model: a `ModelClient`, replies cached on disk, a call bound checked before
every request, one repair for an unusable reply, never in CI. Requirement and Gear text are data.
"""

import hashlib
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from pydantic import ConfigDict, ValidationError

from gears_matcher.judge.llm import CacheError, ModelClient, ResponseCache
from gears_matcher.judge.llm.errors import ClientError
from gears_matcher.judge.models import GearCard
from gears_matcher.models import Frozen, Requirement

__all__ = [
    "CHECK_PROMPT_HASH",
    "REMOVES",
    "CheckError",
    "CheckReply",
    "GearChecker",
    "check_message",
]

Contribution = Literal["outcome", "condition_only", "input_only", "different_object", "cannot_tell"]
REMOVES: frozenset[str] = frozenset({"condition_only", "input_only", "different_object"})
TIMEOUT_S = 300.0

# The check prompt as measured (sprint check, hash 28da910e060e6177). Do not edit without a new
# measurement: the hash below is asserted by the tests.
SYSTEM = (
    "You check proposed matches between one product requirement and catalogue Gears "
    "(reusable software components). For each Gear listed under CHECK, decide what it "
    "contributes to THIS requirement, using only the requirement text and the Gear's "
    "text.\n"
    "Step 1. Write the requirement's main outcome: what its user or calling product gets "
    "(action + object + result). List its conditions separately: who may do it, sign-in "
    "or permission checks, tenant or organisation scoping, limits, formats.\n"
    "Step 2. For each Gear under CHECK choose exactly one contribution:\n"
    "- outcome: the Gear itself performs the main outcome, or a clearly named part of "
    "it, on the same kind of object.\n"
    "- condition_only: the Gear would only enforce or supply one of the conditions "
    "(sign-in, permission, tenant scoping, limits) while the main outcome is produced "
    "elsewhere. If the requirement's main outcome IS that check (for example the "
    "requirement is about verifying tokens, deciding access, or resolving the "
    "organisation tree), choose outcome.\n"
    "- input_only: the Gear only supplies data, a lookup, storage, transport or a "
    "prerequisite step that other logic uses to produce the outcome.\n"
    "- different_object: the Gear does a similar action on a different kind of thing "
    "(for example machines instead of service modules), or acts on the same thing with a "
    "different action.\n"
    "- cannot_tell: the Gear's text is too thin to decide.\n"
    "Step 3. implementation, from the Gear's text: implemented, documented_only, or "
    "unclear.\n"
    "The other Gears listed under ALSO PICKED were proposed for the same requirement; "
    "they are context only."
)
CHECK_PROMPT_HASH = hashlib.sha256(SYSTEM.encode()).hexdigest()[:16]


class CheckError(Exception):
    """A check cannot be answered: CI, the call bound, a bad cache entry, or an unusable reply."""


class _Check(Frozen):
    model_config = ConfigDict(frozen=True, extra="ignore")

    gear_id: str
    contribution: Contribution
    reason: str
    implementation: Literal["implemented", "documented_only", "unclear"]


class CheckReply(Frozen):
    """The reply a check must give."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    main_outcome: str
    conditions: tuple[str, ...]
    checks: tuple[_Check, ...]


@dataclass
class CheckRun:
    """What one checker did in a run."""

    calls: int = 0
    cache_hits: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_errors: list[str] = field(default_factory=list)


def check_message(requirement: Requirement, cards: Sequence[GearCard], also: Sequence[str]) -> str:
    """The user message: the requirement, the Gears to check with their cards, and the other Gears
    proposed for it (context only)."""
    blocks = "\n\n".join(f"[{c.gear_id}]\n{c.text}" for c in cards)
    context = ", ".join(also) if also else "none"
    return (
        f"REQUIREMENT\nTitle: {requirement.title}\n{requirement.text}\n\nCHECK\n{blocks}"
        f"\n\nALSO PICKED (context only): {context}"
    )


class GearChecker:
    """One model running the check. `identity` is the model and its settings (cache key)."""

    def __init__(
        self, client: ModelClient, cache: ResponseCache, *, identity: str, max_calls: int
    ) -> None:
        if os.environ.get("CI"):
            raise CheckError("a Gear check never runs in CI (it calls a paid model)")
        if max_calls < 0:
            raise ValueError(f"max_calls must not be negative, got {max_calls}")
        self._client, self._cache, self._identity = client, cache, identity
        self._max_calls = max_calls
        self.run = CheckRun()

    def is_cached(
        self, requirement: Requirement, cards: Sequence[GearCard], also: Sequence[str]
    ) -> bool:
        return self._cache.path(self._key(check_message(requirement, cards, also))).is_file()

    def check(
        self, requirement: Requirement, cards: Sequence[GearCard], also: Sequence[str]
    ) -> dict[str, Contribution]:
        """Each checked Gear's contribution. A Gear the reply leaves out is absent (never kept)."""
        user = check_message(requirement, cards, also)
        key = self._key(user)
        entry = self._cache.get(key)
        if entry is not None:
            reply = _parse(entry.reply_text)
            if reply is None:
                raise CheckError(f"cache entry {self._cache.path(key).name} is not a valid check")
            self.run.cache_hits += 1
        else:
            reply = self._ask(key, user)
        asked = {c.gear_id for c in cards}
        return {c.gear_id: c.contribution for c in reply.checks if c.gear_id in asked}

    def _key(self, user: str) -> str:
        parts = json.dumps([self._identity, CHECK_PROMPT_HASH, user], ensure_ascii=False)
        return hashlib.sha256(parts.encode()).hexdigest()

    def _ask(self, key: str, user: str) -> CheckReply:
        tokens = [0, 0]
        text = self._request(user, tokens)
        reply = _parse(text)
        if reply is None:  # one repair, as the judge does
            text = self._request(
                f"{user}\n\nYour last reply was not valid. Reply with one JSON object only.", tokens
            )
            reply = _parse(text)
        if reply is None:
            raise CheckError("the reply stayed unusable after one repair")
        try:
            self._cache.put(
                key, model=self._identity, prompt_version=CHECK_PROMPT_HASH, reply_text=text,
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
                system=SYSTEM, user=user, schema=_SCHEMA, timeout_s=TIMEOUT_S
            )
        except ClientError as exc:  # a timeout or provider error: not assessed, never a crash
            raise CheckError(f"the model call failed: {exc}") from exc
        tokens[0] += output.input_tokens
        tokens[1] += output.output_tokens
        self.run.input_tokens += output.input_tokens
        self.run.output_tokens += output.output_tokens
        return output.text


_SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["main_outcome", "conditions", "checks"],
    "properties": {
        "main_outcome": {"type": "string"},
        "conditions": {"type": "array", "items": {"type": "string"}},
        "checks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["gear_id", "contribution", "reason", "implementation"],
                "properties": {
                    "gear_id": {"type": "string"},
                    "contribution": {
                        "enum": [
                            "outcome",
                            "condition_only",
                            "input_only",
                            "different_object",
                            "cannot_tell",
                        ]
                    },
                    "reason": {"type": "string"},
                    "implementation": {"enum": ["implemented", "documented_only", "unclear"]},
                },
            },
        },
    },
}


def _parse(text: str) -> CheckReply | None:
    try:
        return CheckReply.model_validate_json(text.strip())
    except ValidationError:
        return None
