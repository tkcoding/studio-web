"""T8: the recall tripwire (T8 note D10): requirement-shaped blocks nobody claimed.

Two tiers, because one signal cannot do both jobs. **Shaped** is broad (a "can" or "will" in any
case, a user story, a list under a requirements heading): it catches a model that returned nothing,
but real documents are full of it (rationale, scope bullets), so it never gates by ratio. **Strong**
is a block with an uppercase MUST / SHALL / SHOULD / MAY, or a user story: the ratio of those that
no requirement claims is what gates. Measured on Studio, Mini Chat and the todo-app PRDs with an
oracle that quotes T2's own statements (tests/test_extract_real.py): shaped left 42%, 86% and 68%
unclaimed (useless as a gate), strong 5%, 74% and 0% (Mini Chat's long statements span several
blocks, and v1 keeps one).

A tripwire, not a recall measure: free text with no modal word and no list is invisible to it.
"""

import re
from collections.abc import Sequence

from gears_matcher.extract.blocks import Block, Heading

UNCLAIMED_LIMIT = 0.2  # of the strong blocks; checked on three real PRDs, not tuned finely (D10)

_MODAL = re.compile(r"\b(?:must|shall|should|will|needs? to|can|may)\b", re.IGNORECASE)
_STORY = re.compile(r"^\W*as an? \w", re.IGNORECASE)
_RFC = re.compile(r"\b(?:MUST|SHALL|SHOULD|MAY)\b")  # uppercase only, as T2's `must_level`
_SEPARATOR = re.compile(r"^[\s|:\-]+$")  # a table's `|---|---|` row
_REQUIREMENT_SECTION = re.compile(r"requirement|feature|scope|stor(?:y|ies)", re.IGNORECASE)


def shaped_blocks(
    text: str, blocks: Sequence[Block], headings: Sequence[Heading]
) -> tuple[Block, ...]:
    """The blocks that look like a requirement: a modal word in any case, a user story, or a row
    or list item under a heading about requirements, features, scope or stories."""
    found: list[Block] = []
    for i, block in enumerate(blocks):
        if block.kind == "heading":
            continue
        body = text[block.start : block.end]
        if _SEPARATOR.match(body):
            continue
        following = blocks[i + 1] if i + 1 < len(blocks) else None
        header = (
            block.kind == "row"
            and following is not None
            and following.kind == "row"
            and _SEPARATOR.match(text[following.start : following.end]) is not None
        )
        if header:
            continue  # a table's header row names its columns, it states nothing
        under = [h for h in headings if h.start < block.start]
        in_section = bool(under) and _REQUIREMENT_SECTION.search(under[-1].title) is not None
        listed = block.kind in ("row", "item")
        if _MODAL.search(body) or _STORY.match(body) or (listed and in_section):
            found.append(block)
    return tuple(found)


def unclaimed(shaped: Sequence[Block], kept: Sequence[Block]) -> tuple[Block, ...]:
    """The shaped blocks no kept requirement was cut from."""
    taken = {b.start for b in kept}
    return tuple(b for b in shaped if b.start not in taken)


def strong_blocks(text: str, shaped: Sequence[Block]) -> tuple[Block, ...]:
    """The shaped blocks that say MUST / SHALL / SHOULD / MAY in capitals (markdown bold ignored),
    or are a user story: the ones whose loss is a real loss (D10)."""
    found = []
    for block in shaped:
        body = text[block.start : block.end].replace("*", "")
        if _RFC.search(body) or _STORY.match(body):
            found.append(block)
    return tuple(found)
