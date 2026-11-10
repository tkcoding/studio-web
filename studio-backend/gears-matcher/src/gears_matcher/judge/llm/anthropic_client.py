"""T4b: the Anthropic `ModelClient` (T4b note D1, D2, D7, D8, D13). The only module that imports
`anthropic`, so nothing else touches the network.

One request per call: the system prompt, the user prompt, thinking off, the reply constrained to the
reply schema (structured output). The SDK's own retries are off (`max_retries=0`: it waits whatever
`retry-after` says, which no time budget can bound); the client retries by the policy in `retry.py`,
the same as the Constructor client. Sampling parameters are not sent: the current models accept
only their defaults (a request that sends `temperature` is rejected), so reruns are reproducible
through the cache, not through the model.

The API key comes from `ANTHROPIC_API_KEY` and nowhere else. It is never logged, never in an error
message (every message is scrubbed of it) and never in `repr`.
"""

import copy
import os
import re
import time
from typing import Literal, cast

import anthropic
from anthropic.types import (
    Message,
    MessageParam,
    OutputConfigParam,
    ThinkingConfigBetweenToolsParam,
)

from gears_matcher.judge.llm import retry
from gears_matcher.judge.llm.errors import (
    ClientError,
    MissingConfigError,
    ModelRefusedError,
    ProviderError,
    ReplyCutOffError,
)
from gears_matcher.judge.llm.judge import SDK_RETRIES
from gears_matcher.judge.llm.schema import ModelOutput

DEFAULT_MODEL = "claude-sonnet-5-5"
KEY_VARIABLE = "ANTHROPIC_API_KEY"
# Live runs: about 1,500 tokens a reply on average and about 3,500 on the longest; a cut-off raises.
MAX_TOKENS = 8192
Effort = Literal["low", "medium", "high", "xhigh", "max"]
EFFORT: Effort = "medium"
DETAIL_LIMIT = 300

_KEY_SHAPE = re.compile(r"sk-ant-[A-Za-z0-9_\-]+")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")  # terminal escapes and other control characters
# Constraints the structured-output schema subset does not take; the seam re-checks the range.
_DROPPED_KEYWORDS = frozenset(
    {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "title", "default"}
)


MissingApiKeyError = MissingConfigError  # the name the tests and callers already use


__all__ = [
    "DEFAULT_MODEL",
    "KEY_VARIABLE",
    "AnthropicClient",
    "ClientError",
    "MissingApiKeyError",
    "ModelRefusedError",
    "ProviderError",
    "ReplyCutOffError",
    "api_schema",
    "label",
]


def label(
    model: str = DEFAULT_MODEL, *, max_tokens: int = MAX_TOKENS, effort: Effort = EFFORT
) -> str:
    """What identifies this client's settings in the cache key (T4b note D8, D10): the same model
    with other settings makes other replies, so it must not share a cache entry."""
    return f"anthropic/{model}/effort-{effort}/thinking-off/max{max_tokens}/structured-v1"


class AnthropicClient:
    """`ModelClient` for the Anthropic Messages API."""

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        max_tokens: int = MAX_TOKENS,
        effort: Effort = EFFORT,
        http_client: anthropic.DefaultHttpxClient | None = None,
    ) -> None:
        key = os.environ.get(KEY_VARIABLE, "").strip()
        if not key:
            raise MissingApiKeyError(
                f"{KEY_VARIABLE} is not set: export it in your shell or put it in .env"
            )
        self._model = model
        self._max_tokens = max_tokens
        self._effort = effort
        self._secret = key
        self._sdk = anthropic.Anthropic(api_key=key, max_retries=0, http_client=http_client)

    def __repr__(self) -> str:
        key = "set" if self._secret else "not set"
        return f"AnthropicClient(model={self._model!r}, api_key=<{key}>)"

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        messages: list[MessageParam] = [{"role": "user", "content": user}]
        thinking: ThinkingConfigBetweenToolsParam = {"type": "between_tools"}
        output_config: OutputConfigParam = {
            "effort": self._effort,
            "format": {"type": "json_schema", "schema": api_schema(schema)},
        }
        response = self._create(
            system=system,
            messages=messages,
            thinking=thinking,
            output_config=output_config,
            timeout_s=timeout_s,
        )
        if response.stop_reason == "refusal":
            category = getattr(response.stop_details, "category", None)
            raise ModelRefusedError(
                f"the model declined to answer (category: {category or 'none given'})"
            )
        if response.stop_reason == "max_tokens":
            raise ReplyCutOffError(f"the reply was cut off at max_tokens={self._max_tokens}")
        text = next((block.text for block in response.content if block.type == "text"), None)
        if text is None:
            raise ProviderError("the response has no text block")
        return ModelOutput(
            text=text,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

    def _create(
        self,
        *,
        system: str,
        messages: list[MessageParam],
        thinking: ThinkingConfigBetweenToolsParam,
        output_config: OutputConfigParam,
        timeout_s: float,
    ) -> Message:
        """One request, retried by the shared policy (`retry.py`) at most `SDK_RETRIES` times."""
        for attempt in range(SDK_RETRIES + 1):
            if attempt:
                time.sleep(retry.pause_before(attempt))
            try:
                return self._sdk.with_options(timeout=timeout_s).messages.create(
                    model=self._model,
                    max_tokens=self._max_tokens,
                    system=system,
                    messages=messages,
                    thinking=thinking,
                    output_config=output_config,
                )
            except anthropic.APIError as exc:
                status = getattr(exc, "status_code", None)
                where = f" (HTTP {status})" if status else ""
                text = f"{type(exc).__name__}{where}: {exc.message}"
                retriable = (
                    isinstance(exc, anthropic.APIConnectionError) or status in retry.RETRY_STATUSES
                )
                if retriable and attempt < SDK_RETRIES:
                    continue
                suffix = f", after {attempt + 1} attempts" if attempt else ""
                raise ProviderError(self._scrub(text + suffix)) from None
        raise AssertionError("unreachable: the last attempt returns or raises")  # pragma: no cover

    def _scrub(self, text: str) -> str:
        """No key in any message: the exact key, anything shaped like one, short and one line."""
        if self._secret:
            text = text.replace(self._secret, "[redacted]")
        text = _KEY_SHAPE.sub("[redacted]", text)
        text = _CONTROL.sub(" ", text)
        text = " ".join(text.split())
        return text if len(text) <= DETAIL_LIMIT else text[: DETAIL_LIMIT - 1] + "…"


def api_schema(schema: dict[str, object]) -> dict[str, object]:
    """The reply schema in the shape structured output takes: no unsupported constraints, and
    `additionalProperties: false` on every object. A copy; the argument is not changed."""

    def clean(node: object) -> object:
        if isinstance(node, list):
            return [clean(item) for item in node]
        if not isinstance(node, dict):
            return node
        out = {k: clean(v) for k, v in node.items() if k not in _DROPPED_KEYWORDS}
        if out.get("type") == "object":
            out["additionalProperties"] = False
        return out

    return cast(dict[str, object], clean(copy.deepcopy(schema)))
