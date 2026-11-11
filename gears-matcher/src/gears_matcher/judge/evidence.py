"""R1: is an evidence quote really in the gear's card text? (T4 note §4, D4)."""

import difflib
import re
import unicodedata

MIN_WORDS = 3
# A card line can be shorter than MIN_WORDS ("hierarchical multi-tenancy" is a capability line). A
# quote of at least this many words that is a whole line of the card, and not the gear's name, is
# exact and specific, so it counts; a fragment of a line does not.
MIN_WORDS_WHOLE_LINE = 2
# A model often copies a passage with a word or two changed, or joins two pieces with "...". Such a
# quote counts when at least this share of its words is found, in order, in the card text. It is a
# share of the quote, so a quote taken from the requirement (whose words are not in the card) still
# fails.
MIN_SHARE = 0.8

# Curly and other typographic quote marks, equated with the straight ones a model may type.
_SINGLE = (0x2018, 0x2019, 0x201A, 0x201B, 0x2032)  # left, right, low-9, reversed-9, prime
_DOUBLE = (0x201C, 0x201D, 0x201E, 0x201F, 0x2033, 0x00AB, 0x00BB)  # the same, double; guillemets
_QUOTES = str.maketrans({chr(c): "'" for c in _SINGLE} | {chr(c): '"' for c in _DOUBLE})


def normalise(text: str) -> str:
    """NFKC, quote marks equated, case-folded, whitespace collapsed."""
    return " ".join(unicodedata.normalize("NFKC", text).translate(_QUOTES).casefold().split())


def word_count(text: str) -> int:
    return len(normalise(text).split())


def evidence_problem(quote: str, card_text: str, gear_name: str) -> str | None:
    """Why `quote` does not count as evidence for this card, or None when it does.

    A piece of the card text, after `normalise`, of at least `MIN_WORDS` words (or, for a whole
    card line, `MIN_WORDS_WHOLE_LINE`), and not only the gear's name. Quote marks around the whole
    quote are ignored. A quote that is not an exact piece (a word or two changed, or pieces joined
    with "...") still counts when `MIN_SHARE` of its words are found in order in the card
    (`_share_found`).
    """
    needle = normalise(quote).strip("\"' ")
    if not needle:
        return "no evidence quote"
    if len(needle.split()) < MIN_WORDS:
        return _short_problem(needle, card_text, gear_name)
    if needle == normalise(gear_name):
        return "only the gear's name"
    card = normalise(card_text)
    if needle in card or _share_found(_tokens(needle), _tokens(card)) >= MIN_SHARE:
        return None
    return "not found in the gear's card text"


def _short_problem(needle: str, card_text: str, gear_name: str) -> str | None:
    """A quote under `MIN_WORDS` words counts only as a whole card line that is not the name."""
    if needle != normalise(gear_name) and _is_whole_line(needle, card_text):
        return None
    return f"fewer than {MIN_WORDS} words"


def _is_whole_line(needle: str, card_text: str) -> bool:
    """A short quote that is a complete line of the card (a bullet mark in front is ignored)."""
    if len(needle.split()) < MIN_WORDS_WHOLE_LINE:
        return False
    return any(normalise(line).lstrip("-*• ") == needle for line in card_text.splitlines())


def _tokens(text: str) -> list[str]:
    """Letters and digits only, so punctuation and joining marks do not count as words."""
    return re.findall(r"\w+", text)


def _share_found(quote: list[str], card: list[str]) -> float:
    """The share of the quote's words that lie in order inside matching runs of the card."""
    if not quote:
        return 0.0
    matcher = difflib.SequenceMatcher(None, quote, card, autojunk=False)
    return sum(block.size for block in matcher.get_matching_blocks()) / len(quote)
