"""R1: the evidence check (T4 note §4, D4)."""

# ruff: noqa: RUF001 -- curly quotes, full-width letters and no-break spaces are what is tested

import pytest

from gears_matcher.judge.evidence import evidence_problem, normalise, word_count

CARD = "Credentials Store\nStore and retrieve tenant secrets.\nRotate keys on a “schedule”"
NAME = "Credentials Store"


@pytest.mark.parametrize(
    "quote",
    [
        "Store and retrieve tenant secrets.",
        "store AND retrieve   tenant\nsecrets",  # case and whitespace
        "retrieve tenant secrets",
        'Rotate keys on a "schedule"',  # straight quotes for the card's curly ones
        "'Rotate keys on'",  # quote marks around the whole quote
        "Ｓｔｏｒｅ and retrieve",  # full-width letters: NFKC
        "Credentials Store\nStore and",  # across a line break: still one continuous piece
        "Store and … tenant secrets",  # joined pieces: all its words are in the card, in order
        "Store and fetch tenant secrets",  # one word changed in five: 4/5 of the words are found
    ],
)
def test_found(quote: str) -> None:
    assert evidence_problem(quote, CARD, NAME) is None


@pytest.mark.parametrize(
    ("quote", "why"),
    [
        ("", "no evidence quote"),
        ("  '' ", "no evidence quote"),
        ("tenant secrets", "fewer than 3 words"),
        ("Credentials Store", "fewer than 3 words"),
        ("Store and delete the tenant secrets", "not found in the gear's card text"),  # 4/6 found
        ("... ... ...", "not found in the gear's card text"),  # no word to count
        ("The system MUST store secrets", "not found in the gear's card text"),  # spec text
    ],
)
def test_rejected(quote: str, why: str) -> None:
    assert evidence_problem(quote, CARD, NAME) == why


CAPABILITY_CARD = (
    "Tenant Registry\nhierarchical multi-tenancy\n- map external tenant ids\nKeeps the tenant tree."
)


@pytest.mark.parametrize(
    "quote",
    ["hierarchical multi-tenancy", "Hierarchical  Multi-Tenancy", "map external tenant ids"],
)
def test_a_short_quote_that_is_a_whole_card_line_is_found(quote: str) -> None:
    assert evidence_problem(quote, CAPABILITY_CARD, "Tenant Registry") is None


@pytest.mark.parametrize(
    "quote",
    [
        "hierarchical",  # one word: a whole line would still prove nothing
        "multi-tenancy",  # a fragment of a line is not a whole line
        "Tenant Registry",  # the gear's name, even as a whole line
        "tenant tree",  # two words, a fragment of "Keeps the tenant tree."
    ],
)
def test_a_short_quote_that_is_not_a_whole_card_line_is_rejected(quote: str) -> None:
    assert evidence_problem(quote, CAPABILITY_CARD, "Tenant Registry") == "fewer than 3 words"


def test_a_quote_that_is_only_the_name_is_rejected_even_when_long() -> None:
    card = "Simple User Settings\nKeeps per-user settings."
    assert evidence_problem("simple user settings", card, "Simple User Settings") == (
        "only the gear's name"
    )


def test_normalise_and_word_count() -> None:
    assert normalise("  A “B”\t‘c’ ") == "a \"b\" 'c'"
    assert word_count(" one  two\nthree ") == 3
