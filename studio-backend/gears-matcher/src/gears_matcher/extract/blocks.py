"""T8: the blocks of a document, its headings, and its chunks (T8 note §4.3, §4.6, D8).

All of it works on the text with hidden parts blanked (`blank_hidden`), so a block, a heading or a
chunk never holds text a reader does not read, and every offset is an offset in the file.
"""

import bisect
import re
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

from gears_matcher.spec.markdown import heading_of

CHUNK_CHARS = 16_000  # characters per model call (D8)

_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_ROW = re.compile(r"^\s*\|")
_QUOTE = re.compile(r"^\s*>")
_ENDINGS = "\r\n\u2028\u2029\x0b\x0c\x1c\x1d\x1e\x85"  # what `str.splitlines` ends a line at

BlockKind = Literal["paragraph", "item", "row", "quote", "heading"]


@dataclass(frozen=True)
class Block:
    """A paragraph, a list item (with its continuation), a table row, a quote or a heading."""

    start: int
    end: int  # exclusive; the line ending is not part of it
    kind: BlockKind


@dataclass(frozen=True)
class Heading:
    start: int  # offset of its line
    level: int
    title: str


@dataclass(frozen=True)
class Chunk:
    start: int
    end: int


@dataclass
class _Open:
    """A block being read: it grows by one line at a time until a blank line or a new block."""

    start: int
    end: int
    kind: BlockKind

    def done(self) -> Block:
        return Block(self.start, self.end, self.kind)


def _lines(text: str) -> Iterator[tuple[int, int, str]]:
    """(start offset, end offset without the line ending, the line) for every line."""
    offset = 0
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip(_ENDINGS)
        yield offset, offset + len(line), line
        offset += len(raw)


def _flush(blocks: list[Block], current: _Open | None) -> None:
    if current is not None:
        blocks.append(current.done())


def _classify(line: str) -> Literal["blank", "text", "heading", "row", "item", "quote"]:
    if not line.strip():
        return "blank"
    if heading_of(line) is not None:
        return "heading"
    if _ROW.match(line):
        return "row"
    if _ITEM.match(line):
        return "item"
    return "quote" if _QUOTE.match(line) else "text"


def find_blocks(text: str) -> tuple[Block, ...]:
    """The blocks of `text`, in order. A block is the unit a requirement is cut at (D3), so
    nothing needs a sentence splitter, and a list without full stops is still one item each.

    A document with no Markdown structure at all (no heading, list, table or paragraph break) is
    one block per line, so a few lines of notes are not one requirement.
    """
    blocks: list[Block] = []
    current: _Open | None = None
    for start, end, line in _lines(text):
        what = _classify(line)
        if what in ("blank", "heading", "row"):
            _flush(blocks, current)
            current = None
            if what == "heading":
                blocks.append(Block(start, end, "heading"))
            elif what == "row":
                blocks.append(Block(start, end, "row"))
        elif what == "item" or (what == "quote" and (current is None or current.kind != "quote")):
            _flush(blocks, current)
            current = _Open(start, end, "item" if what == "item" else "quote")
        elif current is None:
            current = _Open(start, end, "paragraph")
        else:
            current.end = end  # a wrapped (or quoted) line joins the block above, as in T2
    _flush(blocks, current)
    if len(blocks) == 1 and blocks[0].kind == "paragraph":
        return _by_line(text)
    return tuple(blocks)


def _by_line(text: str) -> tuple[Block, ...]:
    """An unstructured document: one block per non-blank line."""
    return tuple(
        Block(start, end, "paragraph") for start, end, line in _lines(text) if line.strip()
    )


def block_at(blocks: tuple[Block, ...], position: int) -> Block | None:
    """The block that contains character `position`, if any."""
    at = bisect.bisect_right([b.start for b in blocks], position) - 1
    if at >= 0 and blocks[at].start <= position < blocks[at].end:
        return blocks[at]
    return None


def headings(text: str) -> tuple[Heading, ...]:
    """Every heading of `text`, in order, with the offset of its line."""
    found: list[Heading] = []
    offset = 0
    for raw in text.splitlines(keepends=True):
        parsed = heading_of(raw.rstrip("\r\n"))
        if parsed is not None:
            found.append(Heading(offset, parsed[0], parsed[1]))
        offset += len(raw)
    return tuple(found)


def make_chunks(
    text: str, blocks: tuple[Block, ...], limit: int = CHUNK_CHARS
) -> tuple[Chunk, ...]:
    """Cut `text` into chunks of at most `limit` characters, at headings; a section longer than
    that is cut at block boundaries; a single block longer than that is a chunk of its own. The
    chunks follow each other with nothing between them, so no text is lost at a seam, and a block
    is never split. Chunks with nothing in them (all hidden) are left out."""
    if not text.strip():
        return ()
    starts = sorted({b.start for b in blocks if b.kind == "heading"} - {0})
    bounds = [0, *starts, len(text)]
    units: list[tuple[int, int]] = []
    for lo, hi in pairwise(bounds):
        if hi - lo <= limit:
            units.append((lo, hi))
            continue
        inside = [b.start for b in blocks if lo < b.start < hi]
        cuts = [lo, *inside, hi]
        units += list(pairwise(cuts))
    chunks: list[Chunk] = []
    lo, hi = units[0]
    for unit_lo, unit_hi in units[1:]:
        if unit_hi - lo <= limit:
            hi = unit_hi
        else:
            chunks.append(Chunk(lo, hi))
            lo, hi = unit_lo, unit_hi
    chunks.append(Chunk(lo, hi))
    return tuple(c for c in chunks if text[c.start : c.end].strip())


def split_chunk(chunk: Chunk, blocks: tuple[Block, ...]) -> tuple[Chunk, Chunk] | None:
    """A chunk in two at the block boundary nearest its middle; None when it holds one block."""
    inside = [b.start for b in blocks if chunk.start < b.start < chunk.end]
    if not inside:
        return None
    middle = (chunk.start + chunk.end) // 2
    cut = min(inside, key=lambda s: abs(s - middle))
    return Chunk(chunk.start, cut), Chunk(cut, chunk.end)
