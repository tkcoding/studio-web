"""T8: finding a model's quote in a document (design note §4.5, D3, D14)."""

# ruff: noqa: RUF001 -- curly quotes, en dashes and combining marks are what is tested

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.extract.locate import MAX_OCCURRENCES, occurrences, project, quote_problem
from gears_matcher.extract.prompt import escape_chunk, unescape_quote
from gears_matcher.judge.evidence import evidence_problem


def _found(document: str, quote: str) -> list[str]:
    """The original text of every place `quote` is found."""
    return [document[s:e] for s, e in occurrences(project(document), quote)]


def test_a_quote_is_found_at_its_exact_offsets() -> None:
    document = "Intro line.\n\nUsers can sign in with their company account.\n\nMore."
    ((start, end),) = occurrences(project(document), "Users can sign in")
    assert document[start:end] == "Users can sign in"
    assert (start, end) == (13, 30)


def test_whitespace_runs_and_line_breaks_match_a_single_space() -> None:
    document = "Users   can\n  sign\tin  here"
    assert _found(document, "Users can sign in") == ["Users   can\n  sign\tin"]


@pytest.mark.parametrize(
    ("document", "quote", "expected"),
    [
        (
            "The system **MUST** encrypt data.",
            "The system MUST encrypt data.",
            "The system **MUST** encrypt data.",
        ),
        (
            "see `user_id` and _this_",
            "see user_id and this",
            "see `user_id` and _this",
        ),  # trailing marker left out
        (
            "a [link text](http://x) here",
            "a link text(http://x) here",
            "a [link text](http://x) here",
        ),
        ("range 1–2 and a — dash", "range 1-2 and a - dash", "range 1–2 and a — dash"),
        ("it’s “quoted” text", 'it\'s "quoted" text', "it’s “quoted” text"),
        ("café menu", "café menu", "café menu"),  # NFD quote, NFC document
        ("café menu", "café menu", "café menu"),  # NFC quote, NFD document
    ],
)
def test_markdown_dashes_quotes_and_unicode_forms_are_equated(
    document: str, quote: str, expected: str
) -> None:
    assert _found(document, quote) == [expected]


def test_case_is_not_folded() -> None:
    assert _found("Users MUST log in.", "users must log in") == []


def test_a_quote_that_is_not_there_is_not_found() -> None:
    assert _found("Users can sign in.", "Users can sign out") == []
    assert occurrences(project("anything"), "   ") == []


def test_every_occurrence_is_reported_in_order() -> None:
    document = "ab cd. ab cd. xx ab cd"
    spans = occurrences(project(document), "ab cd")
    assert [s for s, _ in spans] == [0, 7, 17]


@pytest.mark.parametrize(
    ("quote", "problem"),
    [
        ("Users can", None),
        ("Dark mode.", None),
        ("Dark", "fewer than 2 words"),
        ("", "fewer than 2 words"),
        ("authentication", "fewer than 2 words"),  # one English word
        ("用户可以登录", None),  # six Chinese characters, no spaces
        ("用户", "fewer than 2 words"),
        ("x " * 400, "longer than 600 characters"),
    ],
)
def test_quote_problem(quote: str, problem: str | None) -> None:
    assert quote_problem(quote) == problem


def test_the_escape_round_trips_so_a_quote_with_angle_brackets_is_found() -> None:
    document = "Latency MUST stay <1 s & the id is <user-id>."
    sent = escape_chunk(document)
    assert "<1" not in sent
    assert "&lt;1" in sent
    quoted_by_the_model = "stay &lt;1 s &amp; the id is &lt;user-id&gt;"
    quote = unescape_quote(quoted_by_the_model)
    assert _found(document, quote) == ["stay <1 s & the id is <user-id>"]
    assert unescape_quote(escape_chunk(document)) == document


@given(st.text(max_size=200))
@settings(max_examples=150, deadline=None)
def test_escape_round_trip_property(text: str) -> None:
    assert unescape_quote(escape_chunk(text)) == text
    assert "<" not in escape_chunk(text)
    assert ">" not in escape_chunk(text)


@pytest.mark.parametrize(
    ("card", "quote"),
    [
        ("The gear stores credentials securely.", "stores credentials securely"),
        ("It’s a “store” for data.", 'it\'s a "store" for data'),
        ("Many   spaces\nand lines here", "spaces and lines here"),
    ],
)
def test_the_locator_and_the_judges_evidence_check_agree_on_their_shared_cases(
    card: str, quote: str
) -> None:
    """A6: two quote guards. Where case is kept, what T4's R1 accepts the locator finds."""
    assert evidence_problem(quote, card, "x") is None
    exact_case = quote if quote in card else None
    found = occurrences(project(card), quote)
    if exact_case is not None:
        assert found
    # and what R1 rejects the locator does not find
    assert evidence_problem("never written here", card, "x") is not None
    assert occurrences(project(card), "never written here") == []


_WORDS = st.lists(
    st.text(alphabet=st.characters(min_codepoint=97, max_codepoint=122), min_size=1, max_size=8),
    min_size=3,
    max_size=30,
)


@given(
    _WORDS,
    st.lists(
        st.sampled_from([" ", "  ", "\n", "\t", " **", "** ", " `", "` ", " "]),
        min_size=40,
        max_size=40,
    ),
    st.data(),
)
@settings(max_examples=150, deadline=None)
def test_a_quote_of_consecutive_words_is_found_whatever_the_markup_between_them(
    words: list[str], seps: list[str], data: st.DataObject
) -> None:
    document = words[0] + "".join(seps[i] + w for i, w in enumerate(words[1:]))
    i = data.draw(st.integers(0, len(words) - 2))
    j = data.draw(st.integers(i + 1, len(words) - 1))
    quote = " ".join(words[i : j + 1])
    found = _found(document, quote)
    assert found, (document, quote)
    for text in found:
        assert text.replace("*", "").replace("`", "").split() == words[
            i : j + 1
        ] or quote in " ".join(text.replace("*", "").replace("`", "").split())


def test_a_hostile_document_cannot_make_a_quote_match_millions_of_times() -> None:
    document = "a " * 50_000
    found = occurrences(project(document), "a a")
    assert len(found) == MAX_OCCURRENCES
    assert found[0] == (0, 3)


def test_a_search_can_be_limited_to_one_range_of_the_document() -> None:
    document = "x y. " * 1100 + "\n\nlater text. x y"
    shown = project(document)
    assert len(occurrences(shown, "x y")) == MAX_OCCURRENCES  # the whole document: capped
    start = document.index("later")
    inside = occurrences(shown, "x y", within=(start, len(document)))
    assert inside == [(len(document) - 3, len(document))]  # the one copy in the range, found
    assert occurrences(shown, "x y", within=(0, 4)) == [(0, 3)]
    assert occurrences(shown, "x y", within=(1, 4)) == []  # a match must lie wholly inside


def test_a_range_cuts_a_match_that_crosses_its_edge() -> None:
    document = "one two three"
    shown = project(document)
    assert occurrences(shown, "two three", within=(0, 9)) == []
    assert occurrences(shown, "two three", within=(4, 13)) == [(4, 13)]
