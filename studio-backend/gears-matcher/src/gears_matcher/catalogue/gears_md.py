"""Parse `docs/GEARS.md` into one entry per gear section.

Structure (measured on `main`): `## <Category>` headings contain `### <Gear>` sections; the file
then ends with scenario write-ups that are not gears. A `###` outside a known category, or one on
the skip list, is never dropped silently: unknown ones are reported, skipped ones are listed.
"""

import posixpath
import re
from dataclasses import dataclass

from gears_matcher.catalogue.models import Issue

CATEGORY_SLUGS = {
    "API Ingress": "api-ingress",
    "Business Logic Gears": "business-logic",
    "Gen AI Gears": "gen-ai",
    "Serverless": "serverless",
    "BSS (Business Support System)": "bss",
    "Core Functionality": "core-functionality",
    "Core Platform Integration Gears": "core-platform-integration",
    "Core Platform Services": "core-platform-services",
    "OSS (Operations Support System)": "oss",
    "Studio": "studio",
}

# `###` sections that are not gears. Explicit and listed in the parse report.
NON_GEAR_SECTIONS = {("Gen AI Gears", "Execution flow overview")}

# Parsing stops at the first heading starting with one of these: scenario write-ups, not gears.
STOP_PREFIXES = ("SCENARIOS", "Sub-scenario", "Typical chat scenario")

_CATEGORY_LEVEL = 2  # `## Category`
_GEAR_LEVEL = 3  # `### Gear`
_DETAIL_LEVEL = 4  # `#### Responsibility`, `#### High level scenarios`, ...

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
_BULLET = re.compile(r"^\s*[-*]\s+(?:(\[[ xX]\])\s*)?(?:(p\d+)\b\s*[-\u2013\u2014:]?\s*)?(.*?)\s*$")
_LINK = re.compile(r"\]\(([^)\s]+)\)")
_STATUS = re.compile(r"^\s*\*\*Status\*\*\s*:", re.IGNORECASE)


@dataclass(frozen=True)
class MdEntry:
    name: str
    category_title: str
    category: str
    responsibility: str
    capabilities: tuple[str, ...]
    doc_paths: tuple[str, ...]
    line: int


@dataclass
class _Section:
    """A `### Gear` section as read: its heading and the raw body lines beneath it."""

    name: str
    category_title: str
    category: str
    line: int
    body: list[str]


@dataclass(frozen=True)
class MdParse:
    entries: tuple[MdEntry, ...]
    skipped: tuple[str, ...]
    markers_stripped: int
    issues: tuple[Issue, ...]


def parse_gears_md(text: str, md_path: str = "docs/GEARS.md") -> MdParse:
    sections, skipped, issues = _split_sections(text, md_path)
    entries: list[MdEntry] = []
    stripped = 0
    for section in sections:
        entry, n_stripped, entry_issues = _entry(section, md_path)
        entries.append(entry)
        stripped += n_stripped
        issues.extend(entry_issues)
    return MdParse(tuple(entries), tuple(skipped), stripped, tuple(issues))


def _split_sections(text: str, md_path: str) -> tuple[list[_Section], list[str], list[Issue]]:
    """Gear sections with their bodies, the skip-listed non-gears, and unrecognised `###`s."""
    sections: list[_Section] = []
    skipped: list[str] = []
    issues: list[Issue] = []
    h2 = ""
    in_fence = False
    current: _Section | None = None

    for lineno, line in enumerate(text.splitlines(), start=1):
        if _FENCE.match(line):
            in_fence = not in_fence
        heading = None if in_fence else _HEADING.match(line)
        if heading is None:
            if current is not None:
                current.body.append(line)
            continue
        level, title = len(heading.group(1)), heading.group(2)
        if level <= _CATEGORY_LEVEL:
            if title.startswith(STOP_PREFIXES):
                break
            current = None
            h2 = title if level == _CATEGORY_LEVEL else ""
        elif level == _GEAR_LEVEL:
            current = _open_section(title, h2, lineno, md_path, sections, skipped, issues)
        elif current is not None:
            current.body.append(line)
    return sections, skipped, issues


def _open_section(  # noqa: PLR0913, PLR0917 -- one call site; shares the parse loop's accumulators
    title: str,
    h2: str,
    lineno: int,
    md_path: str,
    sections: list[_Section],
    skipped: list[str],
    issues: list[Issue],
) -> _Section | None:
    """Handle a `### title`: start a gear section, or record why it is not one."""
    slug = CATEGORY_SLUGS.get(h2)
    if slug is None:
        issues.append(
            Issue(
                severity="error",
                kind="unrecognised_section",
                message=f"`### {title}` under unknown `## {h2 or '(none)'}` — not parsed",
                where=f"{md_path}:{lineno}",
            )
        )
        return None
    if (h2, title) in NON_GEAR_SECTIONS:
        skipped.append(f"{h2} / {title}")
        return None
    section = _Section(title, h2, slug, lineno, [])
    sections.append(section)
    return section


def _entry(section: _Section, md_path: str) -> tuple[MdEntry, int, list[Issue]]:
    prose: list[str] = []
    subs: dict[str, list[str]] = {}
    key: str | None = None
    for line in section.body:
        heading = _HEADING.match(line)
        if heading and len(heading.group(1)) >= _DETAIL_LEVEL:
            key = heading.group(2).strip().lower()
            subs.setdefault(key, [])
        elif key is None:
            prose.append(line)
        else:
            subs[key].append(line)

    issues: list[Issue] = []
    responsibility = _paragraphs(subs.get("responsibility", prose))
    if not responsibility:
        issues.append(
            Issue(
                severity="error",
                kind="missing_responsibility",
                message=f"`{section.name}` has no responsibility text",
                where=f"{md_path}:{section.line}",
            )
        )

    capabilities: list[str] = []
    stripped = 0
    for line in subs.get("high level scenarios", []):
        bullet = _BULLET.match(line)
        if bullet:
            checkbox, priority, text = bullet.groups()
            stripped += bool(checkbox or priority)
            capabilities.append(text)
        elif line.strip() and capabilities and line[:1].isspace():
            capabilities[-1] += " " + line.strip()  # wrapped bullet
    docs = [
        posixpath.normpath(posixpath.join(posixpath.dirname(md_path), target))
        for line in subs.get("more details", [])
        for target in _LINK.findall(line)
        if "://" not in target
    ]
    entry = MdEntry(
        name=section.name,
        category_title=section.category_title,
        category=section.category,
        responsibility=responsibility,
        capabilities=tuple(capabilities),
        doc_paths=tuple(dict.fromkeys(docs)),
        line=section.line,
    )
    return entry, stripped, issues


def _paragraphs(lines: list[str]) -> str:
    """Blank-line separated paragraphs, one line each; readiness `**Status**:` lines dropped."""
    paragraphs: list[str] = []
    buf: list[str] = []
    for line in [*lines, ""]:
        if line.strip() and not _STATUS.match(line):
            buf.append(line.strip())
        elif buf:
            paragraphs.append(" ".join(buf))
            buf = []
    return "\n\n".join(paragraphs)
