"""T11 D22: the main-job check of the `verified` matcher.

A build-list Gear the report check calls "partial" performs a part of the requirement. This check
(Opus) asks one more question: is that part the requirement's main job (core), or only a supporting
step many features need (storing records, checking a sign-in, deciding a permission, a user record,
a setting)? A supporting Gear leaves the build list and is shown under "also possible".

Like the other checks: a `ModelClient`, replies cached on disk, a call bound checked before every
request, one repair for an unusable reply, never in CI. Requirement and Gear text are data.
"""

import hashlib
import json
import os
from typing import Literal

from pydantic import ConfigDict, ValidationError

from gears_matcher.judge.llm import CacheError, ModelClient, ResponseCache
from gears_matcher.judge.llm.errors import ClientError
from gears_matcher.judge.models import GearCard
from gears_matcher.matchers.checks import CheckError, CheckRun
from gears_matcher.models import Frozen, Requirement

__all__ = ["MAIN_JOB_PROMPT_HASH", "MainJobChecker", "MainJobReply", "main_job_message"]

TIMEOUT_S = 300.0

# The prompt as measured (hash asserted by the tests). Do not edit without a new measurement.
SYSTEM = (
    "You decide whether a Gear (a reusable software component) should be recommended for "
    "building one product requirement. An earlier check found that the Gear performs a "
    "part of the requirement. Decide whether that part is the requirement's core or only a "
    "supporting step. Use only the texts shown.\n"
    "Step 1. In a few words, write the requirement's distinctive behaviour: what makes "
    "this requirement different from other features.\n"
    "Step 2. Choose one verdict:\n"
    "- core: the Gear itself performs the distinctive behaviour, or a clearly named piece "
    "of it, on the same kind of object.\n"
    "- supporting: the Gear's part is a generic step that many different features need and "
    "that is not the distinctive behaviour: for example storing records or files, checking "
    "a sign-in or a token, deciding a permission, creating or updating a user record, "
    "saving a configuration value or flag. All of the distinctive behaviour is in the work "
    "left.\n"
    "If the requirement is itself mainly about that step (for example it asks to verify "
    "tokens, decide access, store files or manage users), answer core.\n"
    'Reply with one JSON object: {"distinctive": "...", "verdict": "core" or "supporting", '
    '"reason": "..."}'
)
MAIN_JOB_PROMPT_HASH = hashlib.sha256(SYSTEM.encode()).hexdigest()[:16]

_SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["distinctive", "verdict", "reason"],
    "properties": {
        "distinctive": {"type": "string"},
        "verdict": {"enum": ["core", "supporting"]},
        "reason": {"type": "string"},
    },
}


class MainJobReply(Frozen):
    """The reply the check must give."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    distinctive: str
    verdict: Literal["core", "supporting"]
    reason: str


def main_job_message(requirement: Requirement, card: GearCard, gives: str, left: str) -> str:
    """The user message: the requirement, the Gear's card, and what the report check said the Gear
    performs and what work is left."""
    return (
        f"REQUIREMENT\nTitle: {requirement.title}\n{requirement.text}\n\nGEAR [{card.gear_id}]\n"
        f"{card.text}\n\nPART IT PERFORMS (earlier check): {gives}\n"
        f"WORK LEFT (earlier check): {left}"
    )


class MainJobChecker:
    """One model running the main-job check. `identity` is the model and its settings (cache
    key)."""

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

    def check(
        self, requirement: Requirement, card: GearCard, gives: str, left: str
    ) -> MainJobReply:
        """Core or supporting, with the reason."""
        user = main_job_message(requirement, card, gives, left)
        key = hashlib.sha256(
            json.dumps([self._identity, MAIN_JOB_PROMPT_HASH, user], ensure_ascii=False).encode()
        ).hexdigest()
        entry = self._cache.get(key)
        if entry is not None:
            reply = _parse(entry.reply_text)
            if reply is None:
                raise CheckError(f"cache entry {self._cache.path(key).name} is not a valid check")
            self.run.cache_hits += 1
            return reply
        tokens = [0, 0]
        text = self._request(user, tokens)
        reply = _parse(text)
        if reply is None:  # one repair, as the other checks do
            text = self._request(
                f"{user}\n\nYour last reply was not valid. Reply with one JSON object only.", tokens
            )
            reply = _parse(text)
        if reply is None:
            raise CheckError("the reply stayed unusable after one repair")
        try:
            self._cache.put(
                key, model=self._identity, prompt_version=MAIN_JOB_PROMPT_HASH, reply_text=text,
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


def _parse(text: str) -> MainJobReply | None:
    try:
        return MainJobReply.model_validate_json(text.strip())
    except ValidationError:
        return None
