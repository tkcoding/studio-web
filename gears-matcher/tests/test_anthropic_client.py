"""The Anthropic `ModelClient` against the real SDK on a mock transport: no network, no real key.

The SDK builds the request and parses the response exactly as it would live; only the wire is
replaced. So these tests pin what is sent (and what is never sent) without a paid call.
"""

import json
import logging
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest

from gears_matcher.judge import judge_requirement
from gears_matcher.judge.llm import LLMJudge, ModelReply, retry
from gears_matcher.judge.llm import anthropic_client as ac
from gears_matcher.judge.llm.anthropic_client import (
    DEFAULT_MODEL,
    KEY_VARIABLE,
    MAX_TOKENS,
    AnthropicClient,
    MissingApiKeyError,
    ModelRefusedError,
    ProviderError,
    ReplyCutOffError,
    api_schema,
)
from gears_matcher.judge.llm.judge import SDK_RETRIES
from gears_matcher.judge.llm.retry import RETRY_PAUSE_S
from gears_matcher.models import Gear, Requirement, SourceRef, SpecRef

SECRET = "not-a-real-key-SENTINEL"  # noqa: S105 -- a sentinel, not a credential
Handler = Callable[[httpx2.Request], httpx2.Response]


def message(text: str | None = '{"judgements": []}', **kw: Any) -> dict[str, Any]:
    content = [] if text is None else [{"type": "text", "text": text}]
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": DEFAULT_MODEL,
        "content": content,
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 120, "output_tokens": 30},
    } | kw


def client_for(
    handler: Handler, monkeypatch: pytest.MonkeyPatch, **kw: Any
) -> tuple[AnthropicClient, list[httpx2.Request]]:
    monkeypatch.setenv(KEY_VARIABLE, SECRET)
    seen: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    http = anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(record))
    return AnthropicClient(http_client=http, **kw), seen  # the production wiring, a mock wire


@pytest.fixture(autouse=True)
def no_pauses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(f"{ac.__name__}.time.sleep", lambda seconds: None)  # no real retry pauses


def ok(body: dict[str, Any] | None = None) -> Handler:
    return lambda request: httpx2.Response(200, json=body or message())


def call(client: AnthropicClient) -> Any:
    return client.complete(
        system="the system prompt",
        user="the user prompt",
        schema=ModelReply.model_json_schema(),
        timeout_s=30.0,
    )


# --- what is sent --------------------------------------------------------------------------------


def test_the_request_is_structured_output_with_thinking_off_and_no_sampling_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, seen = client_for(ok(), monkeypatch)
    call(client)
    (request,) = seen
    body = json.loads(request.content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["max_tokens"] == MAX_TOKENS
    assert body["system"] == "the system prompt"
    assert body["messages"] == [{"role": "user", "content": "the user prompt"}]
    assert body["thinking"] == {"type": "between_tools"}
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    # sampling parameters are rejected by the current models: they are never sent
    assert not {"temperature", "top_p", "top_k"} & body.keys()
    assert "tools" not in body  # no forced tool call: that is rejected on this model
    assert "tool_choice" not in body


def test_the_key_goes_in_the_header_and_nowhere_else(monkeypatch: pytest.MonkeyPatch) -> None:
    client, seen = client_for(ok(), monkeypatch)
    call(client)
    (request,) = seen
    assert request.headers["authorization"] == f"Bearer {SECRET}"
    assert SECRET not in request.content.decode()
    assert SECRET not in str(request.url)


def test_the_model_and_effort_are_what_the_caller_chose(monkeypatch: pytest.MonkeyPatch) -> None:
    client, seen = client_for(ok(), monkeypatch, model="claude-haiku-5-5", effort="low")
    call(client)
    body = json.loads(seen[0].content)
    assert (body["model"], body["output_config"]["effort"]) == ("claude-haiku-5-5", "low")


def test_the_sdk_never_retries_by_itself(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(KEY_VARIABLE, SECRET)
    # The production client, not a test double: the SDK honours any `retry-after`, so its own
    # retries are off and the client's bounded loop (retry.py) is the only retry.
    assert AnthropicClient()._sdk.max_retries == 0


def test_the_request_timeout_is_the_one_the_judge_gave(monkeypatch: pytest.MonkeyPatch) -> None:
    client, seen = client_for(ok(), monkeypatch)
    call(client)  # `call` passes timeout_s=30.0
    assert seen[0].extensions["timeout"]["read"] == 30.0


def test_the_reply_schema_is_sent_in_the_shape_structured_output_takes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, seen = client_for(ok(), monkeypatch)
    call(client)
    sent = json.loads(seen[0].content)["output_config"]["format"]["schema"]
    text = json.dumps(sent)
    assert '"minimum"' not in text
    assert '"maximum"' not in text
    assert "judgements" in sent["properties"]


def test_api_schema_drops_unsupported_constraints_closes_objects_and_keeps_the_original() -> None:
    original = ModelReply.model_json_schema()
    before = json.dumps(original, sort_keys=True)
    cleaned = api_schema(original)
    assert json.dumps(original, sort_keys=True) == before  # a copy, never changed in place
    text = json.dumps(cleaned)
    for gone in ("minimum", "maximum", "title", "default"):
        assert f'"{gone}"' not in text
    assert "$defs" in cleaned
    defs = cleaned["$defs"]
    assert isinstance(defs, dict)
    objects = [cleaned, *defs.values()]
    assert all(o["additionalProperties"] is False for o in objects if o.get("type") == "object")
    item = defs["ReplyItem"]
    assert item["properties"]["verdict"]["enum"] == ["covered", "partial", "none", "unjudgeable"]


# --- what comes back -----------------------------------------------------------------------------


def test_the_reply_text_and_the_token_counts_come_back(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = client_for(ok(message('{"judgements": [1]}')), monkeypatch)
    out = call(client)
    assert (out.text, out.input_tokens, out.output_tokens) == ('{"judgements": [1]}', 120, 30)


def test_a_refusal_is_a_clear_error_not_an_empty_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    body = message(
        None,
        stop_reason="refusal",
        stop_details={"type": "refusal", "category": "cyber", "explanation": None},
    )
    client, _ = client_for(ok(body), monkeypatch)
    with pytest.raises(ModelRefusedError, match="category: cyber"):
        call(client)


def test_a_reply_cut_off_at_max_tokens_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = client_for(ok(message('{"judg', stop_reason="max_tokens")), monkeypatch)
    with pytest.raises(ReplyCutOffError, match=f"max_tokens={MAX_TOKENS}"):
        call(client)


def test_a_response_without_text_is_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = client_for(ok(message(None)), monkeypatch)
    with pytest.raises(ProviderError, match="no text block"):
        call(client)


# --- errors and the key --------------------------------------------------------------------------


def error(status: int, message_text: str) -> Handler:
    body = {"type": "error", "error": {"type": "api_error", "message": message_text}}
    return lambda request: httpx2.Response(status, json=body)


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_a_provider_error_names_the_status_and_the_reason(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    client, _ = client_for(error(status, "model not found"), monkeypatch)
    with pytest.raises(ProviderError, match=rf"\(HTTP {status}\): .*model not found"):
        call(client)


def test_a_key_echoed_by_the_provider_never_reaches_an_error_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    echoed = f"invalid x-api-key {SECRET} and sk-ant-api03-AbC_123-xyz also"
    client, _ = client_for(error(401, echoed), monkeypatch)
    with pytest.raises(ProviderError) as caught:
        call(client)
    text = str(caught.value)
    assert SECRET not in text
    assert "sk-ant-" not in text
    assert "[redacted]" in text


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 500])
def test_a_client_error_or_a_500_is_not_retried(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    client, seen = client_for(error(status, "model not found"), monkeypatch)
    with pytest.raises(ProviderError, match=rf"\(HTTP {status}\): .*model not found"):
        call(client)
    assert len(seen) == 1


def test_a_busy_provider_is_retried_and_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"type": "error", "error": {"type": "rate_limit_error", "message": "busy"}}
    answers = iter([httpx2.Response(429, json=body), httpx2.Response(200, json=message())])
    client, seen = client_for(lambda request: next(answers), monkeypatch)
    assert call(client).text == '{"judgements": []}'
    assert len(seen) == 2


@pytest.mark.parametrize("status", [429, 502, 503, 504])
def test_retries_are_bounded_by_the_budget_the_judge_assumes(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    client, seen = client_for(error(status, "busy"), monkeypatch)
    with pytest.raises(ProviderError, match=rf"\(HTTP {status}\): .*busy.*, after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1


def test_a_connection_error_is_retried_and_then_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    client, seen = client_for(refuse, monkeypatch)
    with pytest.raises(ProviderError, match=r"APIConnectionError: .*, after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1


def test_a_timeout_is_retried_and_then_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    def slow(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("took too long", request=request)

    client, seen = client_for(slow, monkeypatch)
    with pytest.raises(ProviderError, match=r"APITimeoutError: .*, after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1


def test_the_retry_table_is_the_shared_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retry, "RETRY_STATUSES", frozenset({418}))
    teapot, seen = client_for(error(418, "short and stout"), monkeypatch)
    with pytest.raises(ProviderError, match="after 3 attempts"):
        call(teapot)
    assert len(seen) == SDK_RETRIES + 1
    busy, seen = client_for(error(429, "busy"), monkeypatch)
    with pytest.raises(ProviderError, match="HTTP 429"):
        call(busy)
    assert len(seen) == 1  # 429 is no longer in the table


def test_the_pause_between_retries_doubles(monkeypatch: pytest.MonkeyPatch) -> None:
    pauses: list[float] = []
    monkeypatch.setattr(f"{ac.__name__}.time.sleep", pauses.append)
    client, _ = client_for(error(503, "busy"), monkeypatch)
    with pytest.raises(ProviderError):
        call(client)
    assert pauses == [RETRY_PAUSE_S, RETRY_PAUSE_S * 2]


def test_a_large_retry_after_does_not_stretch_the_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    pauses: list[float] = []
    monkeypatch.setattr(f"{ac.__name__}.time.sleep", pauses.append)
    body = {"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}}
    client, seen = client_for(
        lambda request: httpx2.Response(429, json=body, headers={"retry-after": "45"}), monkeypatch
    )
    with pytest.raises(ProviderError, match="after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1
    assert pauses == [RETRY_PAUSE_S, RETRY_PAUSE_S * 2]  # never the 45 s the provider asked for


@pytest.mark.parametrize("status", [429, 503])
def test_a_key_echoed_on_the_retry_path_never_reaches_an_error_message(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    client, _ = client_for(
        error(status, f"invalid x-api-key {SECRET} and sk-ant-api03-AbC_123"), monkeypatch
    )
    with pytest.raises(ProviderError) as caught:
        call(client)
    text = str(caught.value)
    assert SECRET not in text
    assert "sk-ant-" not in text
    assert "after 3 attempts" in text


def test_an_error_message_is_one_short_line(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = client_for(error(400, "a\n\n" + "very long " * 100), monkeypatch)
    with pytest.raises(ProviderError) as caught:
        call(client)
    assert "\n" not in str(caught.value)
    assert len(str(caught.value)) <= 300


def test_no_key_in_the_log_or_the_repr_after_a_failed_call(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    client, _ = client_for(error(500, "boom"), monkeypatch)
    with caplog.at_level(logging.DEBUG), pytest.raises(ProviderError):
        call(client)
    assert SECRET not in caplog.text
    assert SECRET not in repr(client)
    assert "api_key=<set>" in repr(client)


@pytest.mark.parametrize("value", [None, "", "   "])
def test_a_missing_or_blank_key_is_an_error_that_names_the_variable(
    monkeypatch: pytest.MonkeyPatch, value: str | None
) -> None:
    if value is None:
        monkeypatch.delenv(KEY_VARIABLE, raising=False)
    else:
        monkeypatch.setenv(KEY_VARIABLE, value)
    with pytest.raises(MissingApiKeyError, match=KEY_VARIABLE):
        AnthropicClient()


def test_the_key_is_read_from_the_environment_at_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(KEY_VARIABLE, f"  {SECRET}  ")
    client = AnthropicClient()
    assert client._secret == SECRET
    assert SECRET not in repr(client)


# --- through the judge and the seam --------------------------------------------------------------

STORE = Gear(
    id="gears-rust/resource-registry",
    name="Resource Registry",
    category=None,
    responsibility="Stores typed resources for each tenant.",
    capabilities=("create and list items",),
    sources=(SourceRef(kind="gears-md", path="docs/GEARS.md", line=1),),
)
REQ = Requirement(
    id="cpt-x-fr-store",
    title="Store tasks",
    text="The system MUST store tasks for every user.",
    kind="fr",
    must_level="MUST",
    priority=None,
    planned=False,
    source=SpecRef(path="PRD.md", line=1),
)


def test_a_real_sdk_reply_flows_through_the_judge_and_the_seam(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    reply = {
        "judgements": [
            {
                "gear_id": STORE.id,
                "verdict": "partial",
                "confidence": 0.7,
                "evidence": "Stores typed resources",
                "covers": "storage for the records",
                "missing": "the task rules",
                "rationale": "a building block",
            }
        ]
    }
    client, seen = client_for(ok(message(json.dumps(reply))), monkeypatch)
    judge = LLMJudge(client, tmp_path / "cache", model=DEFAULT_MODEL, max_calls=3)
    (match,) = judge_requirement(judge, REQ, [STORE])
    assert (match.verdict, match.problem) == ("partial", None)
    assert match.evidence == "Stores typed resources"
    assert len(seen) == 1
    assert judge.usage.input_tokens == 120


def test_a_provider_failure_becomes_a_judge_error_without_the_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    client, _ = client_for(error(401, f"bad key {SECRET}"), monkeypatch)
    judge = LLMJudge(client, tmp_path / "cache", model=DEFAULT_MODEL, max_calls=3)
    (match,) = judge_requirement(judge, REQ, [STORE])
    assert match.problem is not None
    assert match.problem.kind == "judge_error"
    assert "HTTP 401" in match.problem.detail
    assert SECRET not in match.problem.detail
