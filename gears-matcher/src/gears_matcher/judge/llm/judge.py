"""T4b: `LLMJudge`, the real judge behind T4's `MatchJudge` seam (T4b note §3).

One model call per requirement with all its candidates (D3). It returns plain `JudgeReply`s and
decides nothing about them: R1-R8 stay in the seam. The one exception is the repair: a covered or
partial item whose evidence quote fails R1's check is asked about once more (with the same
`evidence_problem` the seam uses), so a near-copy is corrected instead of the gear being lost.
Operational failures raise (a bad cache entry, an unusable reply, an exhausted call or time
budget); the seam records them and the run carries on.
"""

import json
import math
import threading
import time
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import NamedTuple

from pydantic import ValidationError

from gears_matcher.judge.evidence import evidence_problem
from gears_matcher.judge.llm.cache import CacheEntryError, CacheError, ResponseCache, cache_key
from gears_matcher.judge.llm.prompt import PROMPT_VERSION, Prompt, build_prompt, repair_prompt
from gears_matcher.judge.llm.schema import (
    JudgeUsage,
    ModelClient,
    ModelReply,
    RejectedItem,
    ReplyItem,
    UncachedReply,
)
from gears_matcher.judge.models import GearCard, JudgeReply
from gears_matcher.judge.seam import BudgetExceeded
from gears_matcher.models import Requirement

DEFAULT_BUDGET_S = 100.0  # below the seam's 120 s deadline (T4 R5, D7a)
SDK_RETRIES = 2  # transport retries the provider client may make; inside the same time budget
REPAIR_MIN_S = 10.0  # a repair call needs at least this much of the budget left
REASON_LIMIT = 200
IDS_SHOWN = 10  # gear ids named in a repair prompt or a report line
ID_LIMIT = 80


def _now() -> float:
    """The clock for the time budget; tests replace it."""
    return time.monotonic()


class ReplyError(Exception):
    """The reply was unusable, and one repair did not fix it (or there was no time to try)."""


class _Reply(NamedTuple):
    text: str
    items: list[object]
    hard: str | None  # why no judgement can be used at all; None when at least one can


class _Call(NamedTuple):
    prompt: Prompt
    ids: tuple[str, ...]
    deadline: float
    tokens: list[int]
    cards: tuple[GearCard, ...] = ()


class _EnvelopeError(Exception):
    """The reply is not a JSON object with a non-empty `judgements` list."""


class LLMJudge:
    """Implements `MatchJudge`: a model behind a `ModelClient`, a disk cache and a call bound."""

    def __init__(
        self,
        client: ModelClient,
        cache_dir: Path,
        *,
        model: str,
        max_calls: int,
        budget_s: float = DEFAULT_BUDGET_S,
    ) -> None:
        if max_calls < 1:
            raise ValueError(f"max_calls must be at least 1, got {max_calls!r}")
        if not (math.isfinite(budget_s) and budget_s > 0):
            raise ValueError(f"budget_s must be a positive number of seconds, got {budget_s!r}")
        self._client = client
        self._cache = ResponseCache(cache_dir)
        self._model = model
        self._max_calls = max_calls
        self._budget_s = budget_s
        self._lock = (
            threading.Lock()
        )  # a call that outlived the seam's deadline may finish late (D7b)
        self._calls = self._hits = 0
        self._tokens = [0, 0, 0, 0]  # input, output, cached input, cached output
        self._budget_hit = False
        self._rejected: list[RejectedItem] = []
        self._cache_write_errors: list[str] = []
        self._uncached: list[UncachedReply] = []

    @property
    def usage(self) -> JudgeUsage:
        with self._lock:
            return JudgeUsage(
                model=self._model,
                prompt_version=PROMPT_VERSION,
                calls=self._calls,
                cache_hits=self._hits,
                input_tokens=self._tokens[0],
                output_tokens=self._tokens[1],
                cached_input_tokens=self._tokens[2],
                cached_output_tokens=self._tokens[3],
                budget_hit=self._budget_hit,
                rejected_items=tuple(self._rejected),
                cache_write_errors=tuple(self._cache_write_errors),
                uncached_replies=tuple(self._uncached),
            )

    def judge(self, requirement: Requirement, cards: Sequence[GearCard]) -> Sequence[JudgeReply]:
        key = cache_key(self._model, PROMPT_VERSION, requirement, cards)
        entry = self._cache.get(key)
        if entry is None:
            items = self._ask(key, requirement, cards)
        else:
            try:
                items = _items(entry.reply_text)
            except _EnvelopeError as exc:
                raise CacheEntryError(f"cache entry {self._cache.path(key).name}: {exc}") from exc
            unusable = _unusable(items)
            unusable = unusable or _mismatch(items, [c.gear_id for c in cards])
            if (
                unusable is not None
            ):  # never serve a reply that misses the candidates, run after run
                raise CacheEntryError(f"cache entry {self._cache.path(key).name}: {unusable}")
            with self._lock:
                self._hits += 1
                self._tokens[2] += entry.input_tokens
                self._tokens[3] += entry.output_tokens
        return self._replies(requirement, items)

    def _ask(self, key: str, requirement: Requirement, cards: Sequence[GearCard]) -> list[object]:
        """Ask once; repair once if the reply is unusable or misses the candidates (D7).

        A reply with no usable item raises. One that is usable but does not answer the candidates
        (a stray or repeated gear id, a gear left out) is returned for this run and not cached, so
        a rerun asks again instead of replaying it for good. If the repair request itself fails (the
        call bound, a network error), the first reply is kept; of two usable replies the one that
        answers more candidates is kept (the repair, on a tie).
        """
        call = _Call(
            build_prompt(requirement, cards),
            tuple(c.gear_id for c in cards),
            _now() + self._budget_s,
            [0, 0],
            tuple(cards),
        )
        reply = first = self._request(call.prompt, call.deadline, call.tokens)
        problem = (
            first.hard
            or _mismatch(first.items, call.ids)
            or _quote_problem(first.items, call.cards)
        )
        repaired, note = False, ""
        if problem is not None and call.deadline - _now() >= REPAIR_MIN_S:
            repaired = True
            reply, note = self._repair(call, problem, first)
        if reply.hard is not None:
            how = "after one repair" if repaired else "and too little time left to repair it"
            raise ReplyError(f"unusable reply {how}: {reply.hard}")
        left = _mismatch(reply.items, call.ids)
        if left is None:
            self._save(key, reply.text, call.tokens)
        else:
            with self._lock:
                self._uncached.append(
                    UncachedReply(requirement_id=requirement.id, reason=f"{note}{left}")
                )
        return reply.items

    def _repair(self, call: _Call, problem: str, first: _Reply) -> tuple[_Reply, str]:
        """The repair request and which reply to keep (the note says if the repair failed)."""
        try:
            repair = repair_prompt(call.prompt, problem)
            second = self._request(repair, call.deadline, call.tokens)
        except Exception as exc:
            if first.hard is not None:  # nothing usable to fall back on: the failure stands
                raise
            return first, f"the repair request failed ({_ids([type(exc).__name__])}); "
        if second.hard is not None:
            return first, ""
        if first.hard is not None:
            return second, ""

        def score(
            reply: _Reply,
        ) -> tuple[int, int]:  # more candidates answered, then fewer bad quotes
            return _answered(reply.items, call.ids), -len(_bad_quotes(reply.items, call.cards))

        return (first if score(first) > score(second) else second), ""

    def _save(self, key: str, text: str, tokens: list[int]) -> None:
        try:
            self._cache.put(
                key,
                model=self._model,
                prompt_version=PROMPT_VERSION,
                reply_text=text,
                tokens=(tokens[0], tokens[1]),
            )
        except CacheError as exc:  # the reply is paid for and valid: keep it, report the write
            with self._lock:
                self._cache_write_errors.append(" ".join(str(exc).split())[:REASON_LIMIT])

    def _request(self, prompt: Prompt, deadline: float, tokens: list[int]) -> "_Reply":
        """One provider request, inside the call bound and the time budget (D7a, D9)."""
        remaining = deadline - _now()
        if remaining <= 0:  # no request is sent, so none is counted
            raise TimeoutError(f"the judge's time budget of {self._budget_s:g} s is used up")
        with self._lock:
            if self._calls >= self._max_calls:
                self._budget_hit = True
                raise BudgetExceeded(f"the call bound of {self._max_calls} is reached")
            self._calls += 1
        output = self._client.complete(
            system=prompt.system,
            user=prompt.user,
            schema=ModelReply.model_json_schema(),
            timeout_s=remaining / (SDK_RETRIES + 1),
        )
        with self._lock:
            self._tokens[0] += output.input_tokens
            self._tokens[1] += output.output_tokens
        tokens[0] += output.input_tokens
        tokens[1] += output.output_tokens
        try:
            items = _items(output.text)
        except _EnvelopeError as exc:
            return _Reply(output.text, [], str(exc))
        return _Reply(
            output.text, items, _unusable(items)
        )  # no valid item is as bad as no envelope

    def _replies(self, requirement: Requirement, items: list[object]) -> tuple[JudgeReply, ...]:
        """Each item is sorted on its own (D7): valid, well-formed but invalid, or unparseable.

        A valid item goes to the seam. A well-formed but invalid one (an unknown verdict, a
        confidence out of range) goes too, as T4's `JudgeReply`, so the seam records `invalid_reply`
        with the reason on that gear's match. Only an item that does not parse that far is dropped
        and reported.
        """
        replies: list[JudgeReply] = []
        for item in items:
            try:
                replies.append(JudgeReply(**ReplyItem.model_validate(item).model_dump()))
                continue
            except ValidationError:
                pass  # not valid; is it at least a judgement about a gear?
            try:
                replies.append(JudgeReply.model_validate(item))
            except ValidationError as exc:
                self._reject(requirement, item, exc.errors()[0]["msg"])
        return tuple(replies)

    def _reject(self, requirement: Requirement, item: object, reason: str) -> None:
        gear_id = item.get("gear_id") if isinstance(item, dict) else None
        rejected = RejectedItem(
            requirement_id=requirement.id,
            gear_id=gear_id if isinstance(gear_id, str) else "?",
            reason=" ".join(reason.split())[:REASON_LIMIT],
        )
        with self._lock:
            self._rejected.append(rejected)


def _mismatch(items: list[object], candidate_ids: Sequence[str]) -> str | None:
    """Why a reply does not answer these candidates, or None when it does.

    An item counts as an answer when it would reach the seam (it parses as `JudgeReply`), valid or
    not; an unparseable item answers nothing. The seam judges each answer, but it cannot ask again.
    """
    named = Counter(
        reply.gear_id for reply in (_parse(item) for item in items) if reply is not None
    )
    stray = sorted(g for g in named if g not in candidate_ids)
    repeated = sorted(g for g, n in named.items() if n > 1 and g in candidate_ids)
    missing = [g for g in candidate_ids if g not in named]
    parts = [
        f"{what}: {_ids(ids)}"
        for what, ids in (
            ("it names gear ids that are not candidates", stray),
            ("it answers more than once for", repeated),
            ("it has no judgement for", missing),
        )
        if ids
    ]
    return "; ".join(parts) or None


def _bad_quotes(items: list[object], cards: Sequence[GearCard]) -> list[str]:
    """Gear ids with a covered or partial judgement whose evidence quote is not in the card."""
    by_id = {c.gear_id: c for c in cards}
    bad = []
    for item in items:
        reply = _parse(item)
        card = by_id.get(reply.gear_id) if reply is not None else None
        if reply is None or card is None or reply.verdict not in ("covered", "partial"):
            continue
        if evidence_problem(reply.evidence, card.text, card.name) is not None:
            bad.append(reply.gear_id)
    return bad


def _quote_problem(items: list[object], cards: Sequence[GearCard]) -> str | None:
    """The repair text for quotes that are not in the card, or None when every quote is."""
    bad = _bad_quotes(items, cards)
    if not bad:
        return None
    return (
        f"for these gears the evidence is not a piece of that gear's own text: {_ids(bad)}. "
        "Quote one continuous piece of the gear's text, copied exactly, not from the requirement "
        "and not joined with '...'. If you cannot, give the verdict none for that gear"
    )


def _answered(items: list[object], candidate_ids: Sequence[str]) -> int:
    """How many distinct candidates the reply answers (an item that reaches the seam counts)."""
    ids = {r.gear_id for r in (_parse(item) for item in items) if r is not None}
    return len(ids & set(candidate_ids))


def _parse(item: object) -> JudgeReply | None:
    try:
        return JudgeReply.model_validate(item)
    except ValidationError:
        return None


def _ids(ids: Sequence[str]) -> str:
    """Gear ids for a prompt or a report: model-supplied text, so printable, short and without
    angle brackets or quotes, and no more than `IDS_SHOWN` of them."""
    shown = [
        "".join(ch for ch in g if ch.isprintable() and ch not in "<>\"'")[:ID_LIMIT]
        for g in ids[:IDS_SHOWN]
    ]
    more = f" (and {len(ids) - IDS_SHOWN} more)" if len(ids) > IDS_SHOWN else ""
    return ", ".join(shown) + more


def _unusable(items: list[object]) -> str | None:
    """Why a reply holds no judgement at all (every item is invalid), or None when one is valid.

    A partly invalid reply is kept (D7); one with nothing usable is repaired once, then raised,
    and never cached, so a bad reply is not served again on every later run.
    """
    first_error = ""
    for item in items:
        try:
            ReplyItem.model_validate(item)
        except ValidationError as exc:
            first_error = first_error or exc.errors()[0]["msg"]
        else:
            return None
    return f"none of the {len(items)} judgements is valid (first error: {first_error})"


def _items(text: str) -> list[object]:
    """The reply's judgements as raw objects, or `_EnvelopeError`."""
    try:
        document = json.loads(text)
    except ValueError as exc:
        raise _EnvelopeError(f"the reply is not JSON ({exc})") from exc
    judgements = document.get("judgements") if isinstance(document, dict) else None
    if not isinstance(judgements, list):
        raise _EnvelopeError('the reply is not an object with a "judgements" list')
    if not judgements:
        raise _EnvelopeError('"judgements" is empty')
    return judgements
