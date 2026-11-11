"""T8: find a model's quote in a document and say exactly which characters it is (T8 note §4.5).

The document is projected once into a comparison string, with the original offset of every
character kept: NFC, markdown markers removed, dash variants and typographic quotes folded,
whitespace runs collapsed, **case kept**. A quote gets the same projection and is found with a plain
substring search, so no pattern is ever built from model text, and a match maps back to exact
offsets in the original.
"""

import bisect
import unicodedata
from dataclasses import dataclass

MAX_QUOTE = 600  # characters of a quote the model may give (D9)
MIN_WORDS = 2
MIN_UNSPACED = 6  # characters, for a script written without spaces
MAX_OCCURRENCES = 1000  # places one quote may be found: a hostile document cannot make it millions

_MARKERS = frozenset("*_`[]")  # markdown markers: dropped from the comparison text
_DASHES = (0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)  # hyphens, en/em dash, minus
_SINGLE = (0x2018, 0x2019, 0x201A, 0x201B, 0x2032)  # curly single quotes and prime
_DOUBLE = (0x201C, 0x201D, 0x201E, 0x201F, 0x2033, 0x00AB, 0x00BB)  # curly double, guillemets
_FOLD = {
    **dict.fromkeys(_DASHES, "-"),
    **dict.fromkeys(_SINGLE, "'"),
    **dict.fromkeys(_DOUBLE, '"'),
}


@dataclass(frozen=True)
class Projection:
    text: str
    starts: tuple[int, ...]  # the original offset where each projected character starts
    ends: tuple[int, ...]  # and where it ends, exclusive


def project(text: str) -> Projection:
    """`text` in comparison form, with where every character came from."""
    out: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    i, n = 0, len(text)
    while i < n:
        j = i + 1
        while j < n and unicodedata.combining(text[j]):  # a base character and its marks
            j += 1
        for raw in unicodedata.normalize("NFC", text[i:j]):
            ch = raw.translate(_FOLD)
            if ch in _MARKERS:
                continue
            if ch.isspace():
                if out and out[-1] == " ":
                    ends[-1] = j
                    continue
                ch = " "
            out.append(ch)
            starts.append(i)
            ends.append(j)
        i = j
    return Projection("".join(out), tuple(starts), tuple(ends))


def quote_problem(quote: str) -> str | None:
    """Why a quote cannot be used at all, or None. Checked before the document is searched."""
    if len(quote) > MAX_QUOTE:
        return f"longer than {MAX_QUOTE} characters"
    needle = project(quote).text.strip()
    words = needle.split()
    if len(words) >= MIN_WORDS:
        return None
    if len(words) == 1 and len(needle) >= MIN_UNSPACED and _unspaced_script(needle):
        return None
    return f"fewer than {MIN_WORDS} words"


def _unspaced_script(word: str) -> bool:
    """Written without spaces between words (Chinese, Japanese, ...): wide or `Lo` characters."""
    return any(
        unicodedata.east_asian_width(c) in ("W", "F") or unicodedata.category(c) == "Lo"
        for c in word
    )


def occurrences(
    projection: Projection, quote: str, *, within: tuple[int, int] | None = None
) -> list[tuple[int, int]]:
    """Every place `quote` occurs, as (start, end) offsets in the original text, in order, up to
    `MAX_OCCURRENCES`. With `within` (start, end offsets in the original text) only the part of
    the document in that range is searched, and a match must lie wholly inside it: the cap then
    counts the copies in the chunk the model was shown, not in the whole document."""
    needle = project(quote).text.strip()
    if not needle:
        return []
    low, high = 0, len(projection.text)
    if within is not None:
        low = bisect.bisect_left(projection.starts, within[0])
        high = bisect.bisect_right(projection.ends, within[1])
    found: list[tuple[int, int]] = []
    at = projection.text.find(needle, low, high)
    while at >= 0 and len(found) < MAX_OCCURRENCES:
        found.append((projection.starts[at], projection.ends[at + len(needle) - 1]))
        at = projection.text.find(needle, at + 1, high)
    return found
