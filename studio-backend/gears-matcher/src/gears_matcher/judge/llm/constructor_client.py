"""T4b: a `ModelClient` for Constructor's LLM Connectors, an OpenAI-compatible gateway that serves
Claude, GPT and Gemini models behind one access key (T4b note D1, D8, D13).

It is modelled on a single-file example kept outside the repository (it holds a real key): `POST
<base>/chat/completions` with an `X-Model-AccessKey` header, `max_tokens` and `temperature`
(OpenAI's `gpt-5` models take `max_completion_tokens` and no temperature). The gateway does not
enforce a reply schema, so the client asks for JSON in the system prompt and the judge validates
what comes back (and repairs it once), as for any model.

Everything the gateway needs comes from the environment, never from the code or the repository:
the access key and the three identifiers that locate the connector. The key is never logged,
never in an error message and never in `repr`.
"""

import json
import os
import re
import time
from typing import Literal

import httpx2

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

__all__ = [
    "DEFAULT_MODEL",
    "KEY_VARIABLE",
    "SETTING_VARIABLES",
    "ClientError",
    "ConstructorClient",
    "MissingConfigError",
    "ModelRefusedError",
    "ProviderError",
    "ReplyCutOffError",
    "label",
]

KEY_VARIABLE = "LLM_CONNECTORS_ACCESS_KEY"
STAND_VARIABLE = "CONSTRUCTOR_STAND"
CMODEL_VARIABLE = "CONSTRUCTOR_CMODEL_ID"
CONNECTOR_VARIABLE = "CONSTRUCTOR_PUBLIC_CONNECTOR_ID"
MODEL_VARIABLE = "CONSTRUCTOR_MODEL"
SETTING_VARIABLES = (
    KEY_VARIABLE,
    STAND_VARIABLE,
    CMODEL_VARIABLE,
    CONNECTOR_VARIABLE,
    MODEL_VARIABLE,
)

DEFAULT_MODEL = "claude-sonnet-4-6"
# The Anthropic client's value. 4096 cut off `claude-sonnet-5` on a Mini Chat requirement (ten
# judgements, which that model writes at about 1,500 tokens on average); a cut-off reply raises.
MAX_TOKENS = 8192
TEMPERATURE = 0.0
# Models that reject a `temperature` ("`temperature` is deprecated for this model", a 400 seen on
# claude-sonnet-5): no sampling is sent to them, and their replies are made at the model's default.
NO_TEMPERATURE_PREFIXES = (
    "gpt-5",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-fable",
    "claude-mythos",
)
Temperature = float | Literal["auto"] | None  # "auto": 0 where the model takes it; None: none
DETAIL_LIMIT = 300
ERROR_FROM = 400  # an HTTP status from here up is an error

_HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$")
_ID = re.compile(r"^[A-Za-z0-9-]+$")
_FENCE = re.compile(r"^```[A-Za-z]*\s*|\s*```$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")  # terminal escapes and other control characters

FORMAT_INSTRUCTION = (
    "Reply with only one JSON object that validates against this JSON schema. No other text, "
    "no explanation and no code fences.\nSchema: "
)


def effective_temperature(model: str, temperature: Temperature = "auto") -> float | None:
    """The temperature sent for `model`: 0 where it is accepted, none where the model rejects it."""
    if temperature == "auto":
        return None if model.lower().startswith(NO_TEMPERATURE_PREFIXES) else TEMPERATURE
    return temperature


def label(
    model: str = DEFAULT_MODEL, *, max_tokens: int = MAX_TOKENS, temperature: Temperature = "auto"
) -> str:
    """What identifies this client's settings in the cache key (T4b note D8, D10): the same model
    with other settings, or another way of asking for JSON, must not share a cache entry."""
    sent = effective_temperature(model, temperature)
    shown = "default" if sent is None else f"{sent:g}"
    return f"constructor/{model}/t{shown}/max{max_tokens}/json-prompt-v1"


class ConstructorClient:
    """`ModelClient` for a Constructor LLM Connectors connector."""

    def __init__(
        self,
        *,
        model: str | None = None,
        max_tokens: int = MAX_TOKENS,
        temperature: Temperature = "auto",
        http: httpx2.Client | None = None,
    ) -> None:
        env = os.environ
        values = {name: env.get(name, "").strip() for name in SETTING_VARIABLES}
        missing = [
            n
            for n in (KEY_VARIABLE, STAND_VARIABLE, CMODEL_VARIABLE, CONNECTOR_VARIABLE)
            if not values[n]
        ]
        if missing:
            raise MissingConfigError(
                f"{', '.join(missing)} not set: export them in your shell or put them in .env"
            )
        stand, cmodel, connector = (
            values[STAND_VARIABLE],
            values[CMODEL_VARIABLE],
            values[CONNECTOR_VARIABLE],
        )
        if not _HOST.fullmatch(stand):
            raise MissingConfigError(
                f"{STAND_VARIABLE} must be a bare host name, with no scheme or path"
            )
        if not (_ID.fullmatch(cmodel) and _ID.fullmatch(connector)):
            raise MissingConfigError(
                f"{CMODEL_VARIABLE} and {CONNECTOR_VARIABLE} must be plain identifiers"
            )
        self._secret = values[KEY_VARIABLE]
        self._model = model or values[MODEL_VARIABLE] or DEFAULT_MODEL
        self._max_tokens = max_tokens
        self._temperature = effective_temperature(self._model, temperature)
        self._url = (
            f"https://{stand}/api/models/{cmodel}/llm-connectors/v1/connectors/{connector}"
            "/chat/completions"
        )
        self._http = http or httpx2.Client()

    @property
    def model(self) -> str:
        return self._model

    def __repr__(self) -> str:
        return f"ConstructorClient(model={self._model!r}, access_key=<set>)"

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        instruction = FORMAT_INSTRUCTION + json.dumps(schema, separators=(",", ":"))
        body = self._body(f"{system}\n\n{instruction}", user)
        response = self._post(body, timeout_s)
        try:
            document = response.json()
            choice = document["choices"][0]
            finish = choice.get("finish_reason")
            content = choice["message"]["content"]
            usage = document.get("usage") or {}
            tokens = (
                int(usage.get("prompt_tokens") or 0),
                int(usage.get("completion_tokens") or 0),
            )
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
            raise ProviderError(f"unexpected response shape ({type(exc).__name__})") from None
        if finish == "content_filter":
            raise ModelRefusedError("the gateway filtered the reply (finish_reason content_filter)")
        if finish == "length":
            raise ReplyCutOffError(f"the reply was cut off at max_tokens={self._max_tokens}")
        if not isinstance(content, str) or not content.strip():
            raise ProviderError("the response has no text")
        return ModelOutput(text=json_text(content), input_tokens=tokens[0], output_tokens=tokens[1])

    def _body(self, system: str, user: str) -> dict[str, object]:
        body: dict[str, object] = {
            "model": self._model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
        if self._model.lower().startswith("gpt-5"):
            # OpenAI reasoning models take max_completion_tokens; hidden reasoning counts against
            # it, so give it room.
            body["max_completion_tokens"] = max(self._max_tokens, 2000)
        else:
            body["max_tokens"] = self._max_tokens
        if self._temperature is not None:
            body["temperature"] = self._temperature
        return body

    def _post(self, body: dict[str, object], timeout_s: float) -> httpx2.Response:
        """One POST, retried on a transport error or a busy gateway, at most `SDK_RETRIES` times."""
        headers = {"X-Model-AccessKey": self._secret}
        last = "no attempt was made"
        for attempt in range(SDK_RETRIES + 1):
            if attempt:
                time.sleep(retry.pause_before(attempt))
            try:
                response = self._http.post(self._url, headers=headers, json=body, timeout=timeout_s)
            except httpx2.TransportError as exc:  # a timeout, a refused or dropped connection
                last = f"{type(exc).__name__} (no response)"
                continue
            if response.status_code in retry.RETRY_STATUSES:
                last = f"HTTP {response.status_code}: {response.text}"
                continue
            if response.status_code >= ERROR_FROM:
                raise ProviderError(self._scrub(f"HTTP {response.status_code}: {response.text}"))
            return response
        raise ProviderError(self._scrub(f"{last}, after {SDK_RETRIES + 1} attempts"))

    def _scrub(self, text: str) -> str:
        """No key in any message: the exact key removed, one line, short."""
        text = text.replace(self._secret, "[redacted]")
        text = _CONTROL.sub(" ", text)
        text = " ".join(text.split())
        return text if len(text) <= DETAIL_LIMIT else text[: DETAIL_LIMIT - 1] + "…"


def json_text(content: str) -> str:
    """The JSON object in a model's reply: code fences and text around the braces removed.

    Not a validation: whatever this returns, the judge parses it and repairs it once if it is bad.
    """
    text = _FENCE.sub("", content.strip()).strip()
    first, last = text.find("{"), text.rfind("}")
    return text[first : last + 1] if 0 <= first < last else text
