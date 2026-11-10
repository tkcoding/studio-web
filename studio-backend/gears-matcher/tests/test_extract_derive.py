"""T8: what code makes of a block, and the tripwire (design note D4 to D7, D10)."""

import pytest

from gears_matcher.extract.blocks import find_blocks, headings
from gears_matcher.extract.derive import (
    hash_id,
    heading_path,
    make_title,
    names_gear,
    spec_id,
)
from gears_matcher.extract.tripwire import shaped_blocks, strong_blocks, unclaimed
from gears_matcher.models import Gear, SourceRef


def _gear(slug: str, name: str) -> Gear:
    return Gear(
        id=f"gears-rust/{slug}",
        name=name,
        category=None,
        responsibility="x",
        sources=(SourceRef(kind="gears-md", path="GEARS.md", line=1),),
    )


DOC = (
    "# Product\n"  # 0
    "\n"
    "## Users\n"
    "\n"
    "### Sign in\n"
    "\n"
    "- Users can sign in with their company account and more words here.\n"
)


def test_title_is_the_nearest_heading_and_the_first_words() -> None:
    blocks = find_blocks(DOC)
    item = blocks[-1]
    text = DOC[item.start : item.end]
    assert make_title(text, item, headings(DOC), DOC) == "Sign in — Users can sign in with their"


def test_title_without_a_heading_is_the_first_eight_words() -> None:
    text = "Users can sign in with their company account today"
    block = find_blocks(text)[0]
    assert make_title(text, block, (), text) == "Users can sign in with their company account…"
    short = "Users can sign in"
    assert make_title(short, find_blocks(short)[0], (), short) == "Users can sign in"


def test_a_heading_block_is_titled_by_its_own_line() -> None:
    block = find_blocks(DOC)[2]
    assert block.kind == "heading"
    assert make_title(DOC[block.start : block.end], block, headings(DOC), DOC) == "Sign in"


def test_titles_under_one_heading_differ() -> None:
    text = "## Rules\n\n- first rule applies\n- second rule applies\n"
    blocks = [b for b in find_blocks(text) if b.kind == "item"]
    titles = {make_title(text[b.start : b.end], b, headings(text), text) for b in blocks}
    assert len(titles) == 2


def test_a_title_has_no_list_marker_pipes_or_markdown_markers() -> None:
    text = "## S\n\n| **FR-7** | `x_y` works |\n"
    block = find_blocks(text)[-1]
    assert (
        make_title(text[block.start : block.end], block, headings(text), text)
        == "S — FR-7 x y works"
    )


def test_heading_path_runs_from_level_two_and_leaves_out_the_documents_title() -> None:
    heads = headings(DOC)
    assert heading_path(heads, DOC.index("- Users")) == "Users > Sign in"
    assert heading_path(heads, 0) is None
    assert heading_path(headings("## A\n### B\n## C\ntext"), 20) == "C"


@pytest.mark.parametrize(
    ("proposed", "block", "above", "own", "expected"),
    [
        ("FR-12", "| FR-12 | Users can log in | High |", None, False, "FR-12"),
        ("FR-12", "- **FR-12**: Users can log in", None, False, "FR-12"),
        ("FR-12", "1. FR-12 Users can log in", None, False, "FR-12"),
        ("FR-12", "FR-12. Users can log in", None, False, "FR-12"),  # a full stop after it
        ("FR-12", "Users can log in", "FR-12 Login", False, "FR-12"),  # the heading above
        ("FR-12", "### FR-12 Login", None, True, "FR-12"),  # the block is the heading
        ("FR-3", "Users can log in, as in FR-3.", None, False, None),  # a mention, not an ID
        ("R1", "R10: users can log in", None, False, None),  # `R1` is not `R10`
        ("FR-1", "FR-12: users can log in", None, False, None),
        ("FR-1", "FR-1.2 users can log in", None, False, None),  # `FR-1.2` is a longer token
        ("FR-12", "Users can log in", "Login FR-12", False, None),  # not at the heading's start
        ("FR 12", "FR 12 users", None, False, None),  # not a token (a space)
        ("FR-12!", "FR-12! x", None, False, None),  # `!` is not an ID character
        ("", "x", None, False, None),
        (None, "FR-12 x", None, False, None),
        ("A" * 65, "A" * 65 + " x", None, False, None),  # over 64 characters
    ],
)
def test_the_specs_own_id_is_kept_only_where_the_spec_introduces_it(
    proposed: str | None, block: str, above: str | None, own: bool, expected: str | None
) -> None:
    assert spec_id(proposed, block, above, own) == expected


def test_a_hash_id_depends_on_the_words_not_their_place_or_case() -> None:
    assert hash_id("Users can sign in.") == hash_id("  users   CAN sign in.\n")
    assert hash_id("Users can sign in.") != hash_id("Users can sign out.")
    assert hash_id("x y").startswith("t8-")
    assert len(hash_id("x y")) == len("t8-") + 10


GEARS = [
    _gear("credstore", "Credential Store"),
    _gear("graph-storage", "Graph Storage"),
    _gear("types_registry", "Types Registry"),
    _gear("audit", "Audit"),
    _gear("event-broker", "Event Broker"),
]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Credentials live in `credstore`.", ["gears-rust/credstore"]),
        ("We keep a credstore somewhere.", []),  # one plain word, not in backticks
        (
            "Uses graph-storage and the Types-Registry.",
            ["gears-rust/graph-storage", "gears-rust/types_registry"],
        ),
        ("Uses graph_storage here", ["gears-rust/graph-storage"]),
        ("Publish to the event broker.", ["gears-rust/event-broker"]),  # a name of two words
        ("We audit every change.", []),  # "audit" is also ordinary English
        ("A `audit` trail.", ["gears-rust/audit"]),
        ("subgraph-storages are not it", []),  # not a whole token
        ("", []),
    ],
)
def test_names_gear_is_conservative(text: str, expected: list[str]) -> None:
    assert list(names_gear(text, GEARS)) == expected


def test_names_gear_with_no_catalogue_is_empty() -> None:
    assert names_gear("uses `credstore`", ()) == ()


# --- the tripwire --------------------------------------------------------------------------


def _shaped(text: str) -> list[str]:
    blocks = find_blocks(text)
    return [text[b.start : b.end] for b in shaped_blocks(text, blocks, headings(text))]


def test_modal_words_in_any_case_and_user_stories_are_requirement_shaped() -> None:
    text = (
        "Background about why.\n\n"
        "Users must log in.\n\n"
        "The app will send reminders.\n\n"
        "As a member I want to share lists.\n\n"
        "- the app can export\n"
    )
    assert _shaped(text) == [
        "Users must log in.",
        "The app will send reminders.",
        "As a member I want to share lists.",
        "- the app can export",
    ]


def test_a_list_or_row_under_a_requirements_heading_is_shaped_without_a_modal_word() -> None:
    text = "## Features\n\n- Dark mode\n\n## Notes\n\n- Dark mode\n"
    assert _shaped(text) == ["- Dark mode"]


def test_headings_separator_rows_and_table_headers_are_not_shaped() -> None:
    text = "## Requirements\n\n| ID | Statement |\n|----|-----------|\n| R1 | Login |\n"
    assert _shaped(text) == ["| R1 | Login |"]


def test_unclaimed_is_the_shaped_blocks_nothing_was_cut_from() -> None:
    text = "Users must log in.\n\nUsers must log out.\n"
    blocks = find_blocks(text)
    shaped = shaped_blocks(text, blocks, ())
    assert unclaimed(shaped, [blocks[0]]) == (blocks[1],)
    assert unclaimed(shaped, []) == shaped


def test_strong_blocks_are_the_capitalised_keywords_and_user_stories_only() -> None:
    text = (
        "The system MUST log in.\n\n"
        "The system **SHOULD** log out.\n\n"
        "The system must stay lowercase.\n\n"
        "As a member I want lists.\n\n"
        "It MAYBE works.\n"
    )
    blocks = find_blocks(text)
    shaped = shaped_blocks(text, blocks, ())
    got = [text[b.start : b.end] for b in strong_blocks(text, shaped)]
    assert got == [
        "The system MUST log in.",
        "The system **SHOULD** log out.",
        "As a member I want lists.",
    ]
