"""T8: what code makes of a located block: title, ID, heading path, gear names (T8 note D4 to D7).

None of it comes from the model, except an ID the model proposes and the code then finds in the
document by D5's rule.
"""

import hashlib
import re
from collections.abc import Sequence

from gears_matcher.extract.blocks import Block, Heading
from gears_matcher.judge.evidence import normalise
from gears_matcher.models import Gear

TITLE_WORDS_WITH_HEADING = 6
TITLE_WORDS_ALONE = 8
TITLE_LIMIT = 200
_FIRST_SECTION_LEVEL = 2  # the `#` title is the document's, not part of a heading path (as T2)

_ID = re.compile(r"[A-Za-z0-9._:-]{1,64}")
_LIST_MARKER = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_LEADING = " \t|*_`[(#>"


def heading_path(headings: Sequence[Heading], position: int) -> str | None:
    """The headings above `position`, outermost first, from level 2 down (as T2's `heading`)."""
    stack: list[Heading] = []
    for heading in headings:
        if heading.start >= position:
            break
        while stack and stack[-1].level >= heading.level:
            stack.pop()
        stack.append(heading)
    titles = [h.title for h in stack if h.level >= _FIRST_SECTION_LEVEL]
    return " > ".join(titles) or None


def make_title(text: str, block: Block, headings: Sequence[Heading], blank_text: str) -> str:
    """The nearest heading above plus the first words of the text; the first words alone when
    there is no heading (D4). A heading block is titled by its own line."""
    if block.kind == "heading":
        return blank_text[block.start : block.end].lstrip("# ").strip()[:TITLE_LIMIT]
    words = _plain(text).split()
    above = [h for h in headings if h.start < block.start]
    if above:
        title = f"{above[-1].title} — {' '.join(words[:TITLE_WORDS_WITH_HEADING])}"
    else:
        cut = len(words) > TITLE_WORDS_ALONE
        title = " ".join(words[:TITLE_WORDS_ALONE]) + ("…" if cut else "")
    return title[:TITLE_LIMIT]


def _plain(text: str) -> str:
    """`text` for a title: the list marker, table pipes and markdown markers taken off."""
    return re.sub(r"[|*_`]", " ", _LIST_MARKER.sub("", text))


def hash_id(text: str) -> str:
    """`t8-` and ten hex digits of the SHA-256 of the normalised text: the same words give the
    same ID wherever they sit in the document (D5)."""
    return "t8-" + hashlib.sha256(normalise(text).encode()).hexdigest()[:10]


def spec_id(
    proposed: str | None, block_text: str, heading_above: str | None, own_heading: bool
) -> str | None:
    """The spec's own ID, when the model proposed one and the code finds it as a whole token at
    the start of the block, or of the heading line directly above it (D5).

    `### FR-12 Login` and `| FR-12 | text |` count; "as in FR-3" in the middle of a sentence does
    not, and `R1` is not found in `R10`.
    """
    if proposed is None or _ID.fullmatch(proposed) is None:
        return None
    candidates = [block_text] if not own_heading else [block_text.lstrip("# ")]
    if heading_above is not None:
        candidates.append(heading_above)
    return proposed if any(_starts_with_id(c, proposed) for c in candidates) else None


def _starts_with_id(text: str, ident: str) -> bool:
    rest = _LIST_MARKER.sub("", text).lstrip(_LEADING)
    if not rest.startswith(ident):
        return False
    after = rest[len(ident) :]
    if after[:1].isalnum() or after[:1] in ("_", "-"):
        return False  # a longer token: `R1` in `R10`, `FR-1` in `FR-12`
    return not (after[:1] in (".", ":") and after[1:2].isalnum())  # `FR-1.2` is a longer token


def names_gear(text: str, gears: Sequence[Gear]) -> tuple[str, ...]:
    """The full `Gear.id`s the text names, sorted (D7). Conservative on purpose: a gear whose id
    is one plain word ("audit", "cluster") counts only in backticks, because the word is also
    ordinary English; a hyphenated id counts as written (or with `_`); a name of two or more
    words counts as a phrase. A miss is therefore possible, a false hit is rare."""
    folded = normalise(text)
    found: list[str] = []
    for gear in gears:
        slug = gear.id.split("/", 1)[-1].casefold()
        forms = {slug, slug.replace("-", "_"), slug.replace("_", "-")}
        if "-" in slug or "_" in slug:
            hit = any(_token(folded, f) for f in forms)
        else:
            hit = f"`{slug}`" in text.casefold()
        if not hit and len(gear.name.split()) >= 2:  # noqa: PLR2004 -- "two or more words"
            hit = _token(folded, normalise(gear.name))
        if hit:
            found.append(gear.id)
    return tuple(sorted(found))


def _token(folded: str, form: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(form)}(?![a-z0-9])", folded) is not None
