"""The Constructor LLM Connectors `ModelClient`, on a mock transport: no network, no real key.

The shape follows `examples/constructor_sonnet_single.py`: `POST <base>/chat/completions` with an
`X-Model-AccessKey` header. Only the wire is replaced, so these tests pin what is sent and what is
never sent, without a call.
"""

import json
import logging
from collections.abc import Callable
from typing import Any

import httpx2
import pytest

from gears_matcher.judge import judge_requirement
from gears_matcher.judge.llm import LLMJudge, ModelReply, retry
from gears_matcher.judge.llm import constructor_client as cc
from gears_matcher.judge.llm.constructor_client import (
    ConstructorClient,
    MissingConfigError,
    ModelRefusedError,
    ProviderError,
    ReplyCutOffError,
    json_text,
    label,
)
from gears_matcher.judge.llm.judge import SDK_RETRIES
from gears_matcher.judge.llm.retry import RETRY_PAUSE_S
from gears_matcher.models import Gear, Requirement, SourceRef, SpecRef

KEY = "not-a-real-key-SENTINEL"  # a sentinel, not a credential
SETTINGS = {
    "LLM_CONNECTORS_ACCESS_KEY": KEY,
    "CONSTRUCTOR_STAND": "gateway.example.test",
    "CONSTRUCTOR_CMODEL_ID": "11111111-aaaa-bbbb-cccc-222222222222",
    "CONSTRUCTOR_PUBLIC_CONNECTOR_ID": "33333333-dddd-eeee-ffff-444444444444",
}
Handler = Callable[[httpx2.Request], httpx2.Response]


@pytest.fixture(autouse=True)
def settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in cc.SETTING_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    for name, value in SETTINGS.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(f"{cc.__name__}.time.sleep", lambda seconds: None)  # no real retry pauses


def completion(content: Any = '{"judgements": []}', **kw: Any) -> dict[str, Any]:
    return {
        "choices": [
            {"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 120, "completion_tokens": 30},
    } | kw


def client_for(handler: Handler, **kw: Any) -> tuple[ConstructorClient, list[httpx2.Request]]:
    seen: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    http = httpx2.Client(transport=httpx2.MockTransport(record))
    return ConstructorClient(http=http, **kw), seen


def ok(body: dict[str, Any] | None = None) -> Handler:
    return lambda request: httpx2.Response(200, json=body or completion())


def call(client: ConstructorClient, timeout_s: float = 30.0) -> Any:
    return client.complete(
        system="the system prompt",
        user="the user prompt",
        schema=ModelReply.model_json_schema(),
        timeout_s=timeout_s,
    )


# --- what is sent --------------------------------------------------------------------------------


def test_the_request_is_a_chat_completion_to_the_connector_with_the_access_key_header() -> None:
    client, seen = client_for(ok())
    call(client)
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == (
        "https://gateway.example.test/api/models/11111111-aaaa-bbbb-cccc-222222222222"
        "/llm-connectors/v1/connectors/33333333-dddd-eeee-ffff-444444444444/chat/completions"
    )
    assert request.headers["x-model-accesskey"] == KEY
    body = json.loads(request.content)
    assert body["model"] == "claude-sonnet-4-6"
    assert body["max_tokens"] == cc.MAX_TOKENS
    assert body["temperature"] == 0  # the issue's deterministic setting: this route can set it
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["system", "user"]
    assert body["messages"][1]["content"] == "the user prompt"
    assert not {"tools", "tool_choice", "response_format", "stream"} & body.keys()


def test_the_system_prompt_asks_for_json_that_matches_the_reply_schema() -> None:
    client, seen = client_for(ok())
    call(client)
    system = json.loads(seen[0].content)["messages"][0]["content"]
    assert system.startswith("the system prompt")
    assert "Reply with only one JSON object" in system
    assert '"judgements"' in system  # the schema is spelled out: the gateway does not enforce it


def test_the_key_goes_in_the_header_and_nowhere_else() -> None:
    client, seen = client_for(ok())
    call(client)
    (request,) = seen
    assert KEY not in request.content.decode()
    assert KEY not in str(request.url)
    assert [v for k, v in request.headers.items() if KEY in v] == [KEY]


def test_the_timeout_is_passed_to_every_request() -> None:
    client, _ = client_for(ok())
    seen_timeouts: list[float] = []
    original = client._http.post

    def spy(*args: Any, **kwargs: Any) -> httpx2.Response:
        seen_timeouts.append(kwargs["timeout"])
        return original(*args, **kwargs)

    client._http.post = spy  # type: ignore[method-assign]
    call(client, timeout_s=12.5)
    assert seen_timeouts == [12.5]


def test_gpt_5_models_get_max_completion_tokens_and_no_temperature() -> None:
    client, seen = client_for(ok(), model="gpt-5-mini")
    call(client)
    body = json.loads(seen[0].content)
    assert body["max_completion_tokens"] == 8192
    assert not {"max_tokens", "temperature"} & body.keys()
    assert "temperature" not in body
    small, seen2 = client_for(ok(), model="gpt-5-mini", max_tokens=100)
    call(small)
    assert json.loads(seen2[0].content)["max_completion_tokens"] == 2000  # reasoning needs room


def test_the_model_comes_from_the_argument_then_the_environment_then_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert ConstructorClient().model == "claude-sonnet-4-6"
    monkeypatch.setenv("CONSTRUCTOR_MODEL", "claude-haiku-4-5")
    assert ConstructorClient().model == "claude-haiku-4-5"
    assert ConstructorClient(model="gpt-5-mini").model == "gpt-5-mini"


@pytest.mark.parametrize(
    "model",
    ["claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5", "claude-opus-4-8", "gpt-5-mini"],
)
def test_models_that_reject_temperature_get_none(model: str) -> None:
    client, seen = client_for(ok(), model=model)
    call(client)
    assert "temperature" not in json.loads(seen[0].content)
    assert label(model).split("/")[2] == "tdefault"  # a different cache identity than temperature 0


@pytest.mark.parametrize(
    "model", ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"]
)
def test_models_that_take_temperature_get_zero(model: str) -> None:
    client, seen = client_for(ok(), model=model)
    call(client)
    assert json.loads(seen[0].content)["temperature"] == 0


def test_an_explicit_temperature_is_sent_and_none_omits_it() -> None:
    client, seen = client_for(ok(), temperature=0.7)
    call(client)
    assert json.loads(seen[0].content)["temperature"] == 0.7
    quiet, seen2 = client_for(ok(), temperature=None)
    call(quiet)
    assert "temperature" not in json.loads(seen2[0].content)
    assert label("claude-sonnet-4-6", temperature=0.7) != label("claude-sonnet-4-6")


def test_the_label_names_the_model_and_every_setting_that_changes_the_replies() -> None:
    base = label("claude-sonnet-4-6")
    assert base == "constructor/claude-sonnet-4-6/t0/max8192/json-prompt-v1"
    assert label("claude-sonnet-4-6", temperature=0.7) != base
    assert label("claude-sonnet-4-6", max_tokens=1000) != base
    assert label("claude-haiku-4-5") != base


# --- what comes back -----------------------------------------------------------------------------


def test_the_reply_text_and_the_token_counts_come_back() -> None:
    client, _ = client_for(ok(completion('{"judgements": [1]}')))
    out = call(client)
    assert (out.text, out.input_tokens, out.output_tokens) == ('{"judgements": [1]}', 120, 30)


def test_missing_usage_counts_as_zero_tokens() -> None:
    client, _ = client_for(ok({"choices": completion()["choices"]}))
    out = call(client)
    assert (out.input_tokens, out.output_tokens) == (0, 0)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('{"a": 1}', '{"a": 1}'),
        ('```json\n{"a": 1}\n```', '{"a": 1}'),
        ('```\n{"a": 1}\n```', '{"a": 1}'),
        ('Here is the JSON: {"a": {"b": 2}} Hope that helps.', '{"a": {"b": 2}}'),
        ('  \n {"a": 1} \n', '{"a": 1}'),
        ("no braces at all", "no braces at all"),
    ],
)
def test_the_json_object_is_taken_out_of_fences_and_chatter(raw: str, expected: str) -> None:
    assert json_text(raw) == expected


def test_a_fenced_reply_reaches_the_judge_as_plain_json() -> None:
    fenced = '```json\n{"judgements": []}\n```'
    client, _ = client_for(ok(completion(fenced)))
    assert call(client).text == '{"judgements": []}'


def test_a_reply_cut_off_at_the_token_limit_is_an_error() -> None:
    body = completion('{"judg')
    body["choices"][0]["finish_reason"] = "length"
    client, _ = client_for(ok(body))
    with pytest.raises(ReplyCutOffError, match=f"max_tokens={cc.MAX_TOKENS}"):
        call(client)


def test_a_filtered_reply_is_a_refusal() -> None:
    body = completion(None)
    body["choices"][0]["finish_reason"] = "content_filter"
    client, _ = client_for(ok(body))
    with pytest.raises(ModelRefusedError, match="content_filter"):
        call(client)


@pytest.mark.parametrize("content", [None, "", "   ", 42])
def test_a_reply_without_text_is_an_error(content: Any) -> None:
    client, _ = client_for(ok(completion(content)))
    with pytest.raises(ProviderError, match="no text"):
        call(client)


@pytest.mark.parametrize(
    "body",
    [
        {"x": 1},
        {"choices": []},
        {"choices": [{}]},
        {"choices": ["x"]},
        {"choices": [{"message": {}}]},
    ],
)
def test_a_response_of_the_wrong_shape_is_an_error(body: dict[str, Any]) -> None:
    client, _ = client_for(ok(body))
    with pytest.raises(ProviderError, match="unexpected response shape"):
        call(client)


def test_a_response_that_is_not_json_is_an_error() -> None:
    client, _ = client_for(lambda request: httpx2.Response(200, text="<html>gateway</html>"))
    with pytest.raises(ProviderError, match="unexpected response shape"):
        call(client)


# --- errors, retries and the key -----------------------------------------------------------------


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_a_client_error_is_not_retried_and_names_the_status(status: int) -> None:
    client, seen = client_for(lambda request: httpx2.Response(status, text="model not found"))
    with pytest.raises(ProviderError, match=rf"HTTP {status}: model not found"):
        call(client)
    assert len(seen) == 1


def test_a_busy_gateway_is_retried_and_then_succeeds() -> None:
    answers = iter([httpx2.Response(429, text="busy"), httpx2.Response(200, json=completion())])
    client, seen = client_for(lambda request: next(answers))
    assert call(client).text == '{"judgements": []}'
    assert len(seen) == 2


@pytest.mark.parametrize("status", [429, 502, 503, 504])
def test_retries_are_bounded_by_the_budget_the_judge_assumes(status: int) -> None:
    client, seen = client_for(lambda request: httpx2.Response(status, text="busy"))
    with pytest.raises(ProviderError, match=rf"HTTP {status}: busy, after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1


def test_a_transport_error_is_retried_and_then_reported_without_details() -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused to gateway.example.test", request=request)

    client, seen = client_for(refuse)
    with pytest.raises(ProviderError, match=r"ConnectError \(no response\), after 3 attempts"):
        call(client)
    assert len(seen) == SDK_RETRIES + 1


def test_a_timeout_is_a_provider_error() -> None:
    def slow(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("took too long", request=request)

    client, _ = client_for(slow)
    with pytest.raises(ProviderError, match="ReadTimeout"):
        call(client)


def test_the_retry_table_is_the_shared_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(retry, "RETRY_STATUSES", frozenset({418}))
    teapot, seen = client_for(lambda request: httpx2.Response(418, text="short and stout"))
    with pytest.raises(ProviderError, match="after 3 attempts"):
        call(teapot)
    assert len(seen) == SDK_RETRIES + 1
    busy, seen = client_for(lambda request: httpx2.Response(429, text="busy"))
    with pytest.raises(ProviderError, match="HTTP 429"):
        call(busy)
    assert len(seen) == 1  # 429 is no longer in the table


def test_the_pause_between_retries_doubles(monkeypatch: pytest.MonkeyPatch) -> None:
    pauses: list[float] = []
    monkeypatch.setattr(f"{cc.__name__}.time.sleep", pauses.append)
    client, _ = client_for(lambda request: httpx2.Response(503, text="busy"))
    with pytest.raises(ProviderError):
        call(client)
    assert pauses == [RETRY_PAUSE_S, RETRY_PAUSE_S * 2]


@pytest.mark.parametrize("status", [401, 429, 503])  # 429 and 503 end on the retry path
def test_a_key_echoed_by_the_gateway_never_reaches_an_error_message(status: int) -> None:
    client, _ = client_for(lambda request: httpx2.Response(status, text=f"bad access key {KEY}!"))
    with pytest.raises(ProviderError) as caught:
        call(client)
    assert KEY not in str(caught.value)
    assert "[redacted]" in str(caught.value)


def test_control_characters_in_an_error_body_never_reach_the_message() -> None:
    body = "boom \x1b[31mred\x1b[0m\x07 bell\x00 nul"
    client, _ = client_for(lambda request: httpx2.Response(400, text=body))
    with pytest.raises(ProviderError) as caught:
        call(client)
    text = str(caught.value)
    assert not [c for c in text if ord(c) < 32 or 0x7F <= ord(c) <= 0x9F]
    assert "boom" in text
    assert "red" in text
    assert "bell" in text


def test_an_error_message_is_one_short_line() -> None:
    client, _ = client_for(lambda request: httpx2.Response(500, text="a\n\n" + "very long " * 100))
    with pytest.raises(ProviderError) as caught:
        call(client)
    assert "\n" not in str(caught.value)
    assert len(str(caught.value)) <= cc.DETAIL_LIMIT


def test_no_key_in_the_log_or_the_repr_after_a_failed_call(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, _ = client_for(lambda request: httpx2.Response(500, text="boom"))
    with caplog.at_level(logging.DEBUG), pytest.raises(ProviderError):
        call(client)
    assert KEY not in caplog.text
    assert KEY not in repr(client)
    assert "access_key=<set>" in repr(client)


# --- the settings --------------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(SETTINGS))
def test_each_missing_setting_is_an_error_that_names_only_the_variable(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.delenv(name)
    with pytest.raises(MissingConfigError) as caught:
        ConstructorClient()
    assert name in str(caught.value)
    assert KEY not in str(caught.value)


def test_all_missing_settings_are_named_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in SETTINGS:
        monkeypatch.delenv(name)
    with pytest.raises(MissingConfigError) as caught:
        ConstructorClient()
    assert all(name in str(caught.value) for name in SETTINGS)


def test_a_blank_setting_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONSTRUCTOR_STAND", "   ")
    with pytest.raises(MissingConfigError, match="CONSTRUCTOR_STAND"):
        ConstructorClient()


@pytest.mark.parametrize(
    "stand",
    ["https://gateway.example.test", "gateway.example.test/api", "bad host", "-x.test", "a:443"],
)
def test_the_host_must_be_a_bare_name_so_the_key_cannot_be_sent_elsewhere(
    monkeypatch: pytest.MonkeyPatch, stand: str
) -> None:
    monkeypatch.setenv("CONSTRUCTOR_STAND", stand)
    with pytest.raises(MissingConfigError, match="bare host name"):
        ConstructorClient()


@pytest.mark.parametrize("name", ["CONSTRUCTOR_CMODEL_ID", "CONSTRUCTOR_PUBLIC_CONNECTOR_ID"])
def test_the_identifiers_must_be_plain_so_they_cannot_change_the_path(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.setenv(name, "../../other")
    with pytest.raises(MissingConfigError, match="plain identifiers"):
        ConstructorClient()


def test_the_key_is_read_from_the_environment_and_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_CONNECTORS_ACCESS_KEY", f"  {KEY}  ")
    client, seen = client_for(ok())
    call(client)
    assert seen[0].headers["x-model-accesskey"] == KEY


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
GOOD = {
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


def test_a_fenced_gateway_reply_flows_through_the_judge_and_the_seam(tmp_path: Any) -> None:
    fenced = "```json\n" + json.dumps(GOOD) + "\n```"
    client, seen = client_for(ok(completion(fenced)))
    judge = LLMJudge(client, tmp_path / "cache", model=label(), max_calls=3)
    (match,) = judge_requirement(judge, REQ, [STORE])
    assert (match.verdict, match.problem) == ("partial", None)
    assert match.evidence == "Stores typed resources"
    assert len(seen) == 1
    assert judge.usage.input_tokens == 120


def test_a_reply_that_is_not_json_is_repaired_once_through_the_gateway(tmp_path: Any) -> None:
    answers = iter(
        [
            httpx2.Response(200, json=completion("Sure! The first gear covers it.")),
            httpx2.Response(200, json=completion(json.dumps(GOOD))),
        ]
    )
    client, seen = client_for(lambda request: next(answers))
    judge = LLMJudge(client, tmp_path / "cache", model=label(), max_calls=3)
    (match,) = judge_requirement(judge, REQ, [STORE])
    assert match.problem is None
    assert len(seen) == 2  # the first reply, then the repair
    repair = json.loads(seen[1].content)["messages"][1]["content"]
    assert "could not be used" in repair


def test_a_gateway_failure_becomes_a_judge_error_without_the_key(tmp_path: Any) -> None:
    client, _ = client_for(lambda request: httpx2.Response(401, text=f"bad key {KEY}"))
    judge = LLMJudge(client, tmp_path / "cache", model=label(), max_calls=3)
    (match,) = judge_requirement(judge, REQ, [STORE])
    assert match.problem is not None
    assert match.problem.kind == "judge_error"
    assert "HTTP 401" in match.problem.detail
    assert KEY not in match.problem.detail
