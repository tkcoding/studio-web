"""T8: blocks, headings and chunks (design note §4.3, §4.6, D8)."""

# ruff: noqa: RUF001 -- U+2028 is a line ending `str.splitlines` knows, and is tested

from itertools import pairwise

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from gears_matcher.extract.blocks import (
    Block,
    Chunk,
    block_at,
    find_blocks,
    headings,
    make_chunks,
    split_chunk,
)
from gears_matcher.spec.markdown import blank_hidden


def _texts(text: str) -> list[tuple[str, str]]:
    return [(b.kind, text[b.start : b.end]) for b in find_blocks(text)]


def test_blocks_of_a_structured_document() -> None:
    text = (
        "# Title\n"
        "\n"
        "A wrapped\n"
        "paragraph.\n"
        "\n"
        "- first item\n"
        "  continued here\n"
        "- second item\n"
        "1. numbered\n"
        "\n"
        "| a | b |\n"
        "|---|---|\n"
        "| 1 | 2 |\n"
        "\n"
        "> quoted\n"
        "> still quoted\n"
    )
    assert _texts(text) == [
        ("heading", "# Title"),
        ("paragraph", "A wrapped\nparagraph."),
        ("item", "- first item\n  continued here"),
        ("item", "- second item"),
        ("item", "1. numbered"),
        ("row", "| a | b |"),
        ("row", "|---|---|"),
        ("row", "| 1 | 2 |"),
        ("quote", "> quoted\n> still quoted"),
    ]


def test_a_list_without_full_stops_is_one_block_per_item() -> None:
    text = "- Users can log in\n- Users must not share accounts\n- Export to PDF\n"
    assert [t for _, t in _texts(text)] == [
        "- Users can log in",
        "- Users must not share accounts",
        "- Export to PDF",
    ]


def test_a_document_with_no_structure_is_one_block_per_line() -> None:
    text = "Users can sign in.\nThey must not share accounts.\nExport to PDF."
    assert _texts(text) == [
        ("paragraph", "Users can sign in."),
        ("paragraph", "They must not share accounts."),
        ("paragraph", "Export to PDF."),
    ]


def test_a_one_line_spec_is_one_block() -> None:
    text = "a todo app where users sign in, share lists and get reminders"
    assert _texts(text) == [("paragraph", text)]


def test_a_paragraph_break_is_structure_so_wrapped_lines_still_join() -> None:
    text = "First paragraph\nwraps here.\n\nSecond one."
    assert [t for _, t in _texts(text)] == ["First paragraph\nwraps here.", "Second one."]


def test_empty_and_blank_documents_have_no_blocks() -> None:
    assert find_blocks("") == ()
    assert find_blocks("\n  \n\t\n") == ()


@pytest.mark.parametrize("ending", ["\r\n", " "])
def test_offsets_are_right_with_other_line_endings(ending: str) -> None:
    text = f"# H{ending}{ending}- one{ending}- two"
    assert [text[b.start : b.end] for b in find_blocks(text)] == ["# H", "- one", "- two"]


def test_block_at() -> None:
    text = "# H\n\n- one\n- two\n"
    blocks = find_blocks(text)
    assert block_at(blocks, text.index("one")) == Block(5, 10, "item")
    assert block_at(blocks, text.index("\n\n")) is None  # the line ending belongs to no block
    assert block_at(blocks, len(text)) is None
    assert block_at((), 0) is None


def test_headings_have_their_offset_and_level() -> None:
    text = "# T\ntext\n## Two\n### Three ###\n"
    assert [(h.start, h.level, h.title) for h in headings(text)] == [
        (0, 1, "T"),
        (9, 2, "Two"),
        (16, 3, "Three"),
    ]


def test_a_blanked_heading_is_not_a_heading() -> None:
    text = "```\n## Hidden\n```\n## Shown\n"
    assert [h.title for h in headings(blank_hidden(text))] == ["Shown"]


# --- chunks --------------------------------------------------------------------------------


def _doc(sections: int, lines: int = 6) -> str:
    return "".join(
        f"## Section {s}\n\n"
        + "".join(f"- item {s}.{i} must work well\n" for i in range(lines))
        + "\n"
        for s in range(sections)
    )


def test_a_small_document_is_one_chunk() -> None:
    text = _doc(3)
    assert make_chunks(text, find_blocks(text)) == (Chunk(0, len(text)),)


def test_sections_are_packed_greedily_and_cut_at_headings() -> None:
    text = _doc(6)
    blocks = find_blocks(text)
    size = len(_doc(1))
    chunks = make_chunks(text, blocks, limit=size * 2 + 5)
    assert [(c.start, c.end) for c in chunks] == [
        (0, size * 2),
        (size * 2, size * 4),
        (size * 4, size * 6),
    ]
    assert all(text[c.start : c.start + 2] == "##" for c in chunks)


def test_a_section_longer_than_the_limit_is_cut_at_block_boundaries() -> None:
    text = _doc(1, lines=40)
    blocks = find_blocks(text)
    chunks = make_chunks(text, blocks, limit=200)
    assert len(chunks) > 3
    starts = {b.start for b in blocks}
    for chunk in chunks[1:]:
        assert chunk.start in starts
    assert [(a.end, b.start) for a, b in pairwise(chunks)] == [(a.end, a.end) for a in chunks[:-1]]


def test_one_block_longer_than_the_limit_is_a_chunk_of_its_own() -> None:
    text = "- short\n- " + "long " * 100 + "\n- tail\n"
    chunks = make_chunks(text, find_blocks(text), limit=50)
    assert any(c.end - c.start > 50 for c in chunks)
    assert "".join(text[c.start : c.end] for c in chunks) == text


def test_chunks_of_nothing_are_left_out() -> None:
    assert make_chunks("", ()) == ()
    assert make_chunks("   \n  ", ()) == ()
    hidden = blank_hidden("```\ncode\n```\n")
    assert make_chunks(hidden, find_blocks(hidden)) == ()


def test_a_fully_hidden_section_gives_no_chunk_of_its_own() -> None:
    text = "## A\n\n- one must\n\n## Traceability\n\n- x\n\n## B\n\n- two must\n"
    blanked = blank_hidden(text)
    chunks = make_chunks(blanked, find_blocks(blanked), limit=len("## A\n\n- one must\n\n") + 3)
    covered = "".join(blanked[c.start : c.end] for c in chunks)
    assert "x" not in covered
    assert "one must" in covered
    assert "two must" in covered


def test_split_chunk_cuts_at_the_block_boundary_nearest_the_middle() -> None:
    text = "- aaaa\n- bbbb\n- cccc\n- dddd\n"
    blocks = find_blocks(text)
    first, second = split_chunk(Chunk(0, len(text)), blocks) or (None, None)
    assert first == Chunk(0, 14)
    assert second == Chunk(14, len(text))
    assert split_chunk(Chunk(0, 6), blocks) is None  # one block cannot be split


_LINES = st.sampled_from(
    [
        "# Top",
        "## Section",
        "### Deeper",
        "- an item must hold",
        "- another item",
        "| a | b |",
        "|---|---|",
        "plain wrapped text",
        "> quote",
        "",
        "",
    ]
)


@given(st.lists(_LINES, max_size=60), st.integers(20, 200))
@settings(max_examples=200, deadline=None)
def test_chunks_follow_each_other_and_never_split_a_block(lines: list[str], limit: int) -> None:
    text = "\n".join(lines) + "\n"
    blocks = find_blocks(text)
    chunks = make_chunks(text, blocks, limit=limit)
    for a, b in pairwise(chunks):
        assert a.end == b.start  # nothing is lost at a seam
    for block in blocks:
        holders = [c for c in chunks if c.start <= block.start and block.end <= c.end]
        assert len(holders) == 1, block  # every block lies in exactly one chunk
    covered = [False] * len(text)
    for chunk in chunks:
        covered[chunk.start : chunk.end] = [True] * (chunk.end - chunk.start)
    outside = "".join(ch for ch, hit in zip(text, covered, strict=True) if not hit)
    assert not outside.strip()  # only blank text is ever left out


def test_an_unindented_line_under_a_list_item_belongs_to_it_as_in_markdown() -> None:
    text = "- an item\ncontinues here\n\n- next\n"
    assert [t for _, t in _texts(text)] == ["- an item\ncontinues here", "- next"]
