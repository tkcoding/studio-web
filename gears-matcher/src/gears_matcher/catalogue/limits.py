"""T11 D16: what a Gear's own `docs/PRD.md` says it does not do (its stated limits); T11 D17:
what it says it does (`stated_does`, below).

The text kept, in this order:
- every line of a section whose heading says "Out of Scope", "Not in scope" or "Non-goals", up to
  the next heading at the same or a higher level;
- every other line that says something is deferred ("defer"), and when such a line ends with a
  colon, the list items that follow it.

Table rows and HTML comments are skipped; repeated lines count once; the text is cut at
`LIMITS_LIMIT` characters. The verified matcher's checks see it as "Does NOT do" (measured in T11).
"""

import re

__all__ = ["LIMITS_LIMIT", "prd_path", "stated_does", "stated_limits"]

LIMITS_LIMIT = 4500  # characters kept (the setting measured in T11)
PRD_NAME = "/docs/PRD.md"
_HEADING = re.compile(r"^(#+)\s+(.*)")
_SCOPE = re.compile(r"out of scope|not in scope|non-goals?\b", re.IGNORECASE)
_DEFER = re.compile(r"\bdefer", re.IGNORECASE)
_IN_SCOPE = re.compile(r"\bin scope\b", re.IGNORECASE)
_FR_SECTION = re.compile(r"(?<!non-)functional requirements", re.IGNORECASE)
_FR_TITLE = re.compile(r"FR-?\d", re.IGNORECASE)
_FR_ID = re.compile(r"\*\*ID\*\*:\s*`cpt-[\w-]*-fr-")


def prd_path(prds: set[str], gdl_path: str | None, gear_id: str) -> str | None:
    """The PRD of a Gear: `docs/PRD.md` in the folder of its `gear.gdl`, else in the folder above
    (a Gear whose crates sit in sub-folders); never higher, so a PRD shared by a parent folder is
    not read as every Gear's. Without a `gear.gdl`, the only PRD whose folder is named like the
    Gear. None when there is none, or several."""
    if gdl_path is not None:
        parts = gdl_path.split("/")
        for end in range(len(parts) - 1, max(len(parts) - 3, 0), -1):
            candidate = "/".join(parts[:end]) + PRD_NAME
            if candidate in prds:
                return candidate
    named = [p for p in sorted(prds) if p.removesuffix(PRD_NAME).endswith("/" + gear_id)]
    return named[0] if len(named) == 1 else None


def stated_limits(prd: str) -> str | None:
    """The Gear's stated limits from its PRD text (module docstring); None when it states none."""
    scope: list[str] = []
    deferred: list[str] = []
    level: int | None = None
    after_lead = False
    for raw in prd.split("\n"):
        heading = _HEADING.match(raw)
        if heading:
            after_lead = False
            if level is not None and len(heading.group(1)) <= level:
                level = None
            if _SCOPE.search(heading.group(2)):
                level = len(heading.group(1))
                continue
        line = raw.strip()
        if not line or line.startswith(("<!--", "|")):
            continue
        if level is not None:
            scope.append(line)
            continue
        if after_lead and (line.startswith(("-", "* ")) or raw.startswith("  ")):
            deferred.append(line)
            continue
        after_lead = False
        if not heading and _DEFER.search(line):
            deferred.append(line)
            after_lead = line.rstrip("*").endswith(":")
    text = "\n".join(dict.fromkeys(scope + deferred))
    if not text:
        return None
    return text if len(text) <= LIMITS_LIMIT else text[:LIMITS_LIMIT] + " [cut]"


def stated_does(prd: str) -> str | None:
    """T11 D17: what the Gear's PRD says it does: the lines of its "In Scope" section, then the
    title of every functional requirement (a heading that starts with FR-n, or a heading followed
    by an `-fr-` ID line), as "- title". Same skipping, de-duplication and cut as
    `stated_limits`; None when it states neither."""
    scope: list[str] = []
    titles: list[str] = []
    in_scope: int | None = None
    in_fr: int | None = None
    last: str | None = None
    for raw in prd.split("\n"):
        heading = _HEADING.match(raw)
        if heading:
            level, title = len(heading.group(1)), heading.group(2).strip()
            in_scope = None if in_scope is not None and level <= in_scope else in_scope
            in_fr = None if in_fr is not None and level <= in_fr else in_fr
            last = None
            if _IN_SCOPE.search(title) and not _SCOPE.search(title):  # "Not in scope" is a limit
                in_scope = level
            elif _FR_SECTION.search(title):
                in_fr = level
            elif in_fr is not None and _FR_TITLE.match(title):
                titles.append(f"- {title}")
            elif in_fr is not None:
                last = title
            continue
        line = raw.strip()
        if in_scope is not None and line and not line.startswith(("<!--", "|")):
            scope.append(line)
        if last is not None and _FR_ID.search(line):
            titles.append(f"- {last}")
            last = None
    text = "\n".join(dict.fromkeys(scope + titles))
    if not text:
        return None
    return text if len(text) <= LIMITS_LIMIT else text[:LIMITS_LIMIT] + " [cut]"
