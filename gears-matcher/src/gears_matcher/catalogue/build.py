"""Join `GEARS.md` and `gear.gdl` files into one catalogue (pure: trees in, catalogue out)."""

import re
from collections import Counter
from pathlib import Path
from typing import Literal

from gears_matcher.catalogue.aliases import EXTERNAL_NAMES, GDL_TO_MD
from gears_matcher.catalogue.gdl import GdlGear, parse_gdl
from gears_matcher.catalogue.gears_md import MdEntry, parse_gears_md
from gears_matcher.catalogue.limits import PRD_NAME, prd_path, stated_does, stated_limits
from gears_matcher.catalogue.models import Catalogue, Issue, ParseReport
from gears_matcher.catalogue.sources import BundleTree, GitTree, Tree, read_bundle
from gears_matcher.models import (
    SOURCE_NAME,
    Gear,
    Plugin,
    SourceRef,
)

MD_PATH = "docs/GEARS.md"
GDL_NAME = "gear.gdl"
# `docs/GEARS.md` is pinned too, so the same command gives the same catalogue; `origin/main` is
# opt-in.
PINNED_MD_COMMIT = "62d89b0ca1e507bd33cb6345eeaab23da2776198"
# Pinned until gears-rust PR #4793 (feature/gearbox) merges; recorded in the catalogue.
PINNED_GDL_COMMIT = "70a5354d83ed95b84361386f7190b46c5e49c668"
# `gear.gdl` files that are not gears of the platform. Explicit and listed in the parse report.
SKIPPED_GDL_PREFIXES = ("examples/",)


def build_catalogue(
    gears_md: Tree,
    gear_gdl: Tree,
    *,
    source: str = SOURCE_NAME,
    aliases: dict[str, tuple[str, str]] = GDL_TO_MD,
    notes: tuple[Issue, ...] = (),
) -> Catalogue:
    md = parse_gears_md(gears_md.read(MD_PATH), MD_PATH)
    issues = [*notes, *md.issues]

    gdl_gears, skipped = _read_gdl(gear_gdl, issues)
    plugins = [g for g in gdl_gears if g.is_plugin]
    gears = _unique_ids([g for g in gdl_gears if not g.is_plugin], issues)

    for stale in sorted(set(aliases) - {gid for gid, _ in gears}):
        issues.append(
            _issue("error", "stale_alias", f"alias for `{stale}` matches no gear.gdl gear")
        )
    pairing = _join(md.entries, gears, aliases, issues)
    attached = _attach_plugins(gears, plugins, issues)

    out = _gdl_gears(source, gears, md.entries, pairing, attached, issues)
    md_only = _md_only_gears(source, md.entries, set(pairing.values()), gears, issues)
    out.extend(md_only)
    out = _with_limits(out, gear_gdl)

    ids = Counter(g.id for g in out)
    for dup in sorted(i for i, n in ids.items() if n > 1):
        issues.append(_issue("error", "duplicate_id", f"id `{dup}` is used {ids[dup]} times"))
    gdl_only = tuple(f"{source}/{gid}" for gid, _ in gears if gid not in pairing)
    md_only_ids = tuple(g.id for g in md_only)
    _check_counts(len(out), len(md.entries), len(pairing), gdl_only, md_only_ids, issues)
    for gid in (g[len(source) + 1 :] for g in gdl_only):
        issues.append(
            _issue(
                "info",
                "gdl_only",
                f"`{gid}` has no GEARS.md section; kept from gear.gdl",
            )
        )

    report = ParseReport(
        md_sections=len(md.entries),
        md_skipped=md.skipped,
        gdl_gears=len(gears),
        gdl_plugins=len(plugins),
        gdl_skipped=tuple(skipped),
        joined=len(pairing),
        md_only=md_only_ids,
        gdl_only=gdl_only,
        markers_stripped=md.markers_stripped,
        issues=tuple(issues),
    )
    return Catalogue(
        gears_md_commit=gears_md.commit,
        gear_gdl_commit=gear_gdl.commit,
        gears=tuple(out),
        report=report,
    )


def _read_gdl(gear_gdl: Tree, issues: list[Issue]) -> tuple[list[GdlGear], list[str]]:
    """Every readable `gear.gdl` (plugins included) and the files skipped by exception."""
    found: list[GdlGear] = []
    skipped: list[str] = []
    for path in gear_gdl.paths():
        if posix_name(path) != GDL_NAME:
            continue
        if path.startswith(SKIPPED_GDL_PREFIXES):
            skipped.append(path)
            continue
        parsed = parse_gdl(gear_gdl.read(path), path)
        issues.extend(parsed.issues)
        if parsed.gear:
            found.append(parsed.gear)
    return found, skipped


def _with_limits(gears: list[Gear], tree: Tree) -> list[Gear]:
    """T11 D16, D17: each Gear's stated limits and what it says it does, from its own `docs/PRD.md`
    in the gear.gdl tree."""
    prds = {p for p in tree.paths() if p.endswith(PRD_NAME)}
    out: list[Gear] = []
    for g in gears:
        gdl = next((s.path for s in g.sources if s.kind == "gear-gdl"), None)
        path = prd_path(prds, gdl, g.id.split("/", 1)[-1])
        prd = tree.read(path) if path else ""
        stated = {"limits": stated_limits(prd), "does": stated_does(prd)}
        out.append(g.model_copy(update={k: v for k, v in stated.items() if v}))
    return out


def _gdl_gears(  # noqa: PLR0913, PLR0917 -- one call site; a parameter object would only rename them
    source: str,
    gears: list[tuple[str, GdlGear]],
    entries: tuple[MdEntry, ...],
    pairing: dict[str, int],
    attached: dict[str, tuple[Plugin, ...]],
    issues: list[Issue],
) -> list[Gear]:
    """One gear per gear.gdl gear, enriched with its GEARS.md section when it joined."""
    out: list[Gear] = []
    for gid, g in gears:
        entry = entries[pairing[gid]] if gid in pairing else None
        if entry and entry.category != g.category:
            issues.append(
                _issue(
                    "info",
                    "category_mismatch",
                    f"`{gid}`: GEARS.md says {entry.category}, gear.gdl says {g.category};"
                    " using GEARS.md",
                    g.path,
                )
            )
        out.append(_gear(source, gid, g, entry, attached.get(gid, ())))
    return out


def _md_only_gears(
    source: str,
    entries: tuple[MdEntry, ...],
    claimed: set[int],
    gears: list[tuple[str, GdlGear]],
    issues: list[Issue],
) -> list[Gear]:
    """One gear per GEARS.md section no gear.gdl joined; a shared id gets a category suffix."""
    gdl_ids = {gid for gid, _ in gears}
    md_only = [e for i, e in enumerate(entries) if i not in claimed]
    bases = Counter(_slug(e.name) for e in md_only)
    out: list[Gear] = []
    for e in md_only:
        base = _slug(e.name)
        suffixed = base in gdl_ids or bases[base] > 1
        gid = f"{base}--{e.category}" if suffixed else base
        if suffixed:
            issues.append(
                _issue(
                    "info",
                    "duplicate_name",
                    f"`{e.name}` shares its id; kept as `{gid}`",
                    f"{MD_PATH}:{e.line}",
                )
            )
        out.append(_gear(source, gid, None, e, ()))
    return out


def _check_counts(  # noqa: PLR0913, PLR0917 -- one call site; a parameter object would only rename them
    total: int,
    md_sections: int,
    joined: int,
    gdl_only: tuple[str, ...],
    md_only: tuple[str, ...],
    issues: list[Issue],
) -> None:
    """Every parsed section ends up in exactly one gear: joined + gdl-only + md-only."""
    if total != joined + len(gdl_only) + len(md_only) or md_sections != joined + len(md_only):
        issues.append(
            _issue("error", "count_mismatch", "gears do not add up to the parsed sections")
        )


def build_from_repo(
    repo: Path,
    md_ref: str = PINNED_MD_COMMIT,
    gdl_ref: str = PINNED_GDL_COMMIT,
    bundle: Path | None = None,
) -> Catalogue:
    """Both sources from one `gears-rust` checkout: `GEARS.md` at `md_ref`, gdl at `gdl_ref`.

    A `bundle` (`examples/gears.gdl`) replaces the `gear.gdl` text of the gears it holds at the same
    path; a bundle gear with no file at `gdl_ref` is not used, and the parse report says so.
    """
    md = GitTree(repo, md_ref)  # first, so a bad `--md-ref` is the error a person sees first
    gdl: Tree = GitTree(repo, gdl_ref)
    notes: list[Issue] = []
    if bundle is not None:
        gdl = BundleTree(gdl, read_bundle(bundle))
        notes = [
            _issue("info", "bundle_unused", f"the bundle's `{path}` has no file at {gdl_ref[:7]}")
            for path in gdl.unused
        ]
    return build_catalogue(md, gdl, notes=tuple(notes))


class AmbiguousGearError(LookupError):
    """A name matches several gears; `candidates` lists their ids."""

    def __init__(self, name: str, candidates: tuple[str, ...]) -> None:
        super().__init__(f"`{name}` matches several gears: {', '.join(candidates)}")
        self.candidates = candidates


def resolve_gear(catalogue: Catalogue, name: str) -> Gear | None:
    """Find a gear by id tail, name, crate or alias (`mini_chat`, `cf-gears-credstore`, ...).

    Returns `None` when nothing matches; raises `AmbiguousGearError` when several gears do.
    """
    key = _key(name)
    key = EXTERNAL_NAMES.get(key, key)
    hits = sorted(
        {
            g.id
            for g in catalogue.gears
            if key in {_key(g.id.split("/", 1)[-1]), _key(g.name), *_crate_keys(g.crate)}
        }
    )
    if len(hits) > 1:
        raise AmbiguousGearError(name, tuple(hits))
    return catalogue.by_id()[hits[0]] if hits else None


def has_code(gear: Gear) -> bool:
    """T11: the Gear can be used today: its `gear.gdl` declares a crate (`package = cargo(...)`).

    A `gear.gdl` with `maturity = "design"` declares none: the Gear is described, has no crate yet
    and is not usable in a product (GBX0321), like a Gear documented in GEARS.md only.
    """
    return gear.crate is not None


def _join(
    entries: tuple[MdEntry, ...],
    gears: list[tuple[str, GdlGear]],
    aliases: dict[str, tuple[str, str]],
    issues: list[Issue],
) -> dict[str, int]:
    """gdl gear id -> index of its GEARS.md entry.

    Alias table first, else the normalised name (plus category when the name is ambiguous).
    """
    by_name: dict[str, list[int]] = {}
    for i, e in enumerate(entries):
        by_name.setdefault(_norm(e.name), []).append(i)
    pairing: dict[str, int] = {}
    taken: dict[int, str] = {}
    for gid, g in gears:
        if gid in aliases:
            name, category = aliases[gid]
            found = [i for i in by_name.get(_norm(name), []) if entries[i].category == category]
            if not found:
                issues.append(
                    _issue(
                        "error",
                        "stale_alias",
                        f"alias `{gid}` -> `{name}` ({category}) not in GEARS.md",
                        g.path,
                    )
                )
        else:
            found = by_name.get(_norm(g.name), [])
            if len(found) > 1:
                found = [i for i in found if entries[i].category == g.category]
                if len(found) != 1:
                    issues.append(
                        _issue(
                            "error",
                            "ambiguous_join",
                            f"`{g.name}` matches several GEARS.md sections",
                            g.path,
                        )
                    )
                    found = []
        if len(found) != 1:
            continue
        if found[0] in taken:
            issues.append(
                _issue(
                    "error",
                    "duplicate_join",
                    f"`{gid}` and `{taken[found[0]]}` join the same section",
                    g.path,
                )
            )
            continue
        pairing[gid] = found[0]
        taken[found[0]] = gid
    return pairing


def _attach_plugins(
    gears: list[tuple[str, GdlGear]], plugins: list[GdlGear], issues: list[Issue]
) -> dict[str, tuple[Plugin, ...]]:
    """Parent = the gear whose extension point the plugin implements, else a gear on its path."""
    attached: dict[str, list[Plugin]] = {}
    for p in plugins:
        parents = [gid for gid, g in gears if p.implements and p.implements in g.extension_points]
        if len(parents) != 1:
            prefix = p.path.split("/plugins/")[0] + "/"
            parents = [
                gid
                for gid, g in gears
                if posix_dir(p.path).startswith(posix_dir(g.path) + "/")
                or posix_dir(g.path).startswith(prefix)
            ]
        if len(parents) != 1:
            issues.append(
                _issue(
                    "error",
                    "orphan_plugin",
                    f"plugin `{p.name}` has {len(parents)} candidate parent gears",
                    p.path,
                )
            )
            continue
        attached.setdefault(parents[0], []).append(
            Plugin(name=p.name, crate=p.crate, implements=p.implements, path=p.path)
        )
    return {gid: tuple(ps) for gid, ps in attached.items()}


def _unique_ids(gears: list[GdlGear], issues: list[Issue]) -> list[tuple[str, GdlGear]]:
    seen: Counter[str] = Counter()
    out = []
    for g in gears:
        seen[g.id] += 1
        gid = g.id if seen[g.id] == 1 else f"{g.id}--{seen[g.id]}"
        if seen[g.id] > 1:
            issues.append(
                _issue(
                    "error",
                    "duplicate_id",
                    f"gear.gdl id `{g.id}` repeats; kept as `{gid}`",
                    g.path,
                )
            )
        out.append((gid, g))
    return out


def _gear(
    source: str,
    gid: str,
    g: GdlGear | None,
    e: MdEntry | None,
    plugins: tuple[Plugin, ...],
) -> Gear:
    refs = []
    if e:
        refs.append(SourceRef(kind="gears-md", path=MD_PATH, line=e.line))
    if g:
        refs.append(SourceRef(kind="gear-gdl", path=g.path, line=g.line))
    return Gear(
        id=f"{source}/{gid}",
        name=g.name if g else _need(e).name,
        category=e.category if e else _need(g).category,
        responsibility=e.responsibility if e else _need(g).description,
        description=g.description if g else None,
        capabilities=e.capabilities if e else (),
        crate=g.crate if g else None,
        plugins=plugins,
        doc_paths=e.doc_paths if e else (),
        sources=tuple(refs),
    )


def _need[T](value: T | None) -> T:
    if value is None:  # `_gear` is only called with at least one source
        raise AssertionError("gear has neither a GEARS.md entry nor a gear.gdl file")
    return value


def _crate_keys(crate: str | None) -> list[str]:
    if not crate:
        return []
    return [_key(crate), _key(re.sub(r"^cf-(gears-)?", "", crate))]


def _key(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower().replace("&", "and"))


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-")


def posix_name(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def posix_dir(path: str) -> str:
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _issue(
    severity: Literal["error", "info"],
    kind: str,
    message: str,
    where: str | None = None,
) -> Issue:
    return Issue(severity=severity, kind=kind, message=message, where=where)
