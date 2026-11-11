"""The two provider clients carry the same protection; a test fails when they stop agreeing (A6)."""

import pytest

from gears_matcher.judge.llm import anthropic_client as ac
from gears_matcher.judge.llm import constructor_client as cc

KEY = "sentinel-key-value"  # a sentinel, not a credential


def test_both_clients_share_the_same_limits() -> None:
    assert ac.MAX_TOKENS == cc.MAX_TOKENS
    assert ac.DETAIL_LIMIT == cc.DETAIL_LIMIT


@pytest.mark.parametrize(
    "text",
    [
        f"bad key {KEY} here",
        "esc \x1b[31mred\x1b[0m bell \x07 nul \x00 end",
        "line one\nline two\ttab",
        "x" * 1000,
    ],
)
def test_both_clients_scrub_error_text_the_same_way(text: str) -> None:
    constructor = cc.ConstructorClient.__new__(cc.ConstructorClient)
    constructor._secret = KEY
    anthropic = ac.AnthropicClient.__new__(ac.AnthropicClient)
    anthropic._secret = KEY
    assert constructor._scrub(text) == anthropic._scrub(text)
