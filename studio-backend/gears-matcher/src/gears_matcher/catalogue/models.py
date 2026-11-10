"""Catalogue-only records: the parse report and the catalogue. `Gear` is in `models`."""

from gears_matcher.models import SOURCE_NAME, Frozen, Gear, Issue

__all__ = ["SOURCE_NAME", "Catalogue", "Issue", "ParseReport"]


class ParseReport(Frozen):
    md_sections: int  # gear sections found in GEARS.md (after the explicit skips)
    md_skipped: tuple[str, ...]  # non-gear `###` sections skipped by exception
    gdl_gears: int  # gear.gdl files that are gears (not plugins, not skipped)
    gdl_plugins: int
    gdl_skipped: tuple[str, ...]  # files skipped by exception (examples/)
    joined: int
    md_only: tuple[str, ...]  # gear ids present only in GEARS.md
    gdl_only: tuple[str, ...]  # gear ids present only in gear.gdl
    markers_stripped: int  # `[x]`/`[ ]` + `pN` prefixes removed from scenario lines
    issues: tuple[Issue, ...] = ()

    @property
    def errors(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.severity == "error")


class Catalogue(Frozen):
    gears_md_commit: str | None
    gear_gdl_commit: str | None
    gears: tuple[Gear, ...]
    report: ParseReport

    def by_id(self) -> dict[str, Gear]:
        return {g.id: g for g in self.gears}
