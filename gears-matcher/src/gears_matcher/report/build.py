"""T5: turn T4's matches into the coverage report (T5 note §4-§6).

Deterministic and model-free: the same spec, catalogue, shortlist and matches give the same report.
Bad input is a wiring error and raises `ReportInputError` (D11); nothing is guessed.
"""

from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.models import Clarification, Gear, Match, Requirement
from gears_matcher.report.models import (
    SCHEMA_VERSION,
    Coverage,
    CoverageCounts,
    CoverageReport,
    GearMatch,
    GearUse,
    Provenance,
    RequirementCoverage,
    Role,
    RunSettings,
    Totals,
)
from gears_matcher.spec.models import Spec

_SUPPORTING = ("covered", "partial")
_SHOWN = 5  # ids named in an error message, at most
# D12: the chosen gear, then the others that help, then the rest; a confident `none` never
# outranks a gear that helps
_ROLE_ORDER: dict[str, int] = {"chosen": 0, "alternative": 1, "other": 2}


class ReportInputError(ValueError):
    """The inputs do not fit together. `kind` is stable; the message names what is wrong."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(f"{kind}: {message}")
        self.kind = kind


def build_report(  # noqa: PLR0913 -- the report's inputs, each a different thing the caller has
    spec: Spec,
    catalogue: Catalogue,
    shortlist: Mapping[str, Sequence[str]],
    matches: Sequence[Match],
    *,
    settings: RunSettings,
    failed: Mapping[str, str] | None = None,
    future: Mapping[str, str] | None = None,
    has_code: Callable[[Gear], bool] | None = None,
    clarifications: Sequence[Clarification] = (),
) -> CoverageReport:
    """One report for one spec: per requirement, the lean gear list, totals and provenance.

    `failed` names requirements a matcher could not assess at all (T11: a whole-catalogue call
    failed), with the reason; they are reported as not assessed. `future` names requirements whose
    only plausible Gears have no code yet (T11 D5, D8): a gap, with the reason given. `has_code`
    says which Gears can be used today (default: the Gear has a `gear.gdl`); the Gears that help
    without code are also listed as future parts, by how many requirements need them (T11 D15)."""
    gears = catalogue.by_id()
    by_requirement = _check_inputs(spec.requirements, gears, shortlist, matches)
    failed = failed or {}
    future = future or {}
    known = {r.id for r in spec.requirements}
    for kind, given in (
        ("unknown_failed_requirement", failed),
        ("unknown_future_requirement", future),
    ):
        unknown = sorted(set(given) - known)
        if unknown:
            raise ReportInputError(kind, _names(unknown))
    rows = tuple(
        roll_up(
            r, by_requirement[r.id], settings.tau, failed=failed.get(r.id), future=future.get(r.id)
        )
        for r in spec.requirements
    )
    code = has_code or _has_gdl
    recommended, also = _gear_lists(rows, gears, settings.tau, code)
    future_parts = _future_parts(rows, gears, code)
    return CoverageReport(
        schema_version=SCHEMA_VERSION,
        provenance=Provenance(
            product_id=spec.product_id,
            spec_repository=spec.repository,
            spec_commit=spec.commit,
            gears_md_commit=catalogue.gears_md_commit,
            gear_gdl_commit=catalogue.gear_gdl_commit,
            judge=settings.judge,
            shortlist=settings.shortlist,
            tau=settings.tau,
            extraction=settings.extraction,
        ),
        recommended_gears=recommended,
        also_possible=also,
        future_parts=future_parts,
        requirements=rows,
        totals=_totals(rows),
        inputs=spec.inputs,
        clarifications=tuple(clarifications),
    )


def coverage_of(matches: Sequence[Match]) -> tuple[Coverage, str]:  # noqa: PLR0911 -- one per rule
    """C1-C6: one coverage value for one requirement's matches, and the reason in one line."""
    if not matches:
        return "gap", "no candidate gear"  # C6
    chosen = _chosen(matches)
    if chosen is not None:
        helping = sum(m.verdict in _SUPPORTING for m in matches) - 1
        more = (
            f"; {helping} other gear{'s also help' if helping != 1 else ' also helps'}"
            if helping
            else ""
        )
        if chosen.verdict == "covered":
            return "covered", f"covered by {chosen.gear_id}{more}"  # C1
        return "partial", f"partly covered by {chosen.gear_id}{more}"  # C2
    undecided = [m for m in matches if m.verdict == "unjudgeable"]
    if undecided and all(m.problem is None for m in undecided):  # C3 (T11 D6: also with nones)
        first = min(undecided, key=lambda m: m.gear_id)
        if len(undecided) == len(matches):
            return (
                "clarification_needed",
                f"the judge could not decide for any gear: {first.rationale}",
            )
        return (
            "clarification_needed",
            f"the judge could not decide for {len(undecided)} of {len(matches)} gears: "
            f"{first.rationale}",
        )
    if undecided:  # C4
        why = Counter(m.problem.kind if m.problem else "judge could not decide" for m in undecided)
        detail = ", ".join(f"{kind} x{n}" for kind, n in sorted(why.items()))
        return "not_assessed", f"not decided for {len(undecided)} of {len(matches)} gears: {detail}"
    return "gap", "every candidate judged none"  # C5


def roll_up(
    requirement: Requirement,
    matches: Sequence[Match],
    tau: float,
    *,
    failed: str | None = None,
    future: str | None = None,
) -> RequirementCoverage:
    """One requirement's row: its coverage, the chosen gear and every candidate (D3, D4, D9).
    T11: `failed`, the matcher could not assess it (not assessed); `future`, only Gears with no code
    yet fit and none is chosen (a gap with that reason)."""
    coverage, reason = coverage_of(matches)
    if failed:
        coverage, reason = "not_assessed", failed
    elif future and _chosen(matches) is None:
        coverage, reason = "gap", future
    chosen = _chosen(matches)
    rows = [
        GearMatch(
            gear_id=m.gear_id,
            verdict=m.verdict,
            confidence=m.confidence,
            evidence=m.evidence,
            covers=m.covers,
            missing=m.missing,
            rationale=m.rationale,
            problem=m.problem,
            role=_role(m, chosen),
        )
        for m in matches
    ]
    rows.sort(key=lambda g: (_ROLE_ORDER[g.role], -g.confidence, g.gear_id))  # D12
    return RequirementCoverage(
        requirement_id=requirement.id,
        kind=requirement.kind,
        planned=requirement.planned,
        extracted=requirement.origin == "extracted",
        coverage=coverage,
        confidence=chosen.confidence if chosen else None,
        low_confidence=chosen is not None and chosen.confidence < tau,
        reason=reason,
        gear_provides=chosen.covers if chosen else "",
        remaining_work=chosen.missing if chosen else "",
        gears=tuple(rows),
    )


def _chosen(matches: Sequence[Match]) -> Match | None:
    """D3: the best supporting match, covered before partial, then confidence, then gear id."""
    helping = [m for m in matches if m.verdict in _SUPPORTING]
    if not helping:
        return None
    return min(helping, key=lambda m: (m.verdict != "covered", -m.confidence, m.gear_id))


def _role(match: Match, chosen: Match | None) -> Role:
    if chosen is not None and match.gear_id == chosen.gear_id:
        return "chosen"
    return "alternative" if match.verdict in _SUPPORTING else "other"


def _gear_lists(
    rows: tuple[RequirementCoverage, ...],
    gears: Mapping[str, Gear],
    tau: float,
    code: Callable[[Gear], bool],
) -> tuple[tuple[GearUse, ...], tuple[GearUse, ...]]:
    """D3, D5: recommended = chosen somewhere at >= tau; also possible = every other helper with
    code. T11 D19: a helper with no code is listed only under future parts, where it always is, so a
    person is never asked to confirm a Gear that cannot be used yet."""
    chosen: dict[str, list[tuple[str, float]]] = {}
    helping: dict[str, list[tuple[str, float]]] = {}
    for row in rows:
        for g in row.gears:
            if g.role == "chosen":
                chosen.setdefault(g.gear_id, []).append((row.requirement_id, g.confidence))
            if g.verdict in _SUPPORTING or _to_confirm(g):
                helping.setdefault(g.gear_id, []).append((row.requirement_id, g.confidence))
    recommended = {gid for gid, uses in chosen.items() if max(c for _, c in uses) >= tau}
    rec = [_use(gears[gid], chosen[gid], code) for gid in recommended]
    also = [
        _use(gears[gid], uses, code)
        for gid, uses in helping.items()
        if gid not in recommended and code(gears[gid])
    ]
    return _sorted(rec), _sorted(also)


def _future_parts(
    rows: tuple[RequirementCoverage, ...], gears: Mapping[str, Gear], code: Callable[[Gear], bool]
) -> tuple[GearUse, ...]:
    """T11 D15: every Gear with no code that helps a requirement (chosen, supporting or to
    confirm), with the requirements that need it; the most needed first (demand for the Gear)."""
    needed: dict[str, list[tuple[str, float]]] = {}
    for row in rows:
        for g in row.gears:
            if not code(gears[g.gear_id]) and (g.verdict in _SUPPORTING or _to_confirm(g)):
                needed.setdefault(g.gear_id, []).append((row.requirement_id, g.confidence))
    uses = [_use(gears[gid], found, code) for gid, found in needed.items()]
    return tuple(sorted(uses, key=lambda u: (-len(u.requirement_ids), u.gear_id)))


def _has_gdl(gear: Gear) -> bool:
    return any(s.kind == "gear-gdl" for s in gear.sources)


def _to_confirm(g: GearMatch) -> bool:
    """T11 D4/D7: a Gear the judge could not decide on by itself (no problem) is shown for a person
    to confirm; a Gear whose judging failed is not."""
    return g.verdict == "unjudgeable" and g.problem is None


def _use(gear: Gear, uses: list[tuple[str, float]], code: Callable[[Gear], bool]) -> GearUse:
    return GearUse(
        gear_id=gear.id,
        name=gear.name,
        confidence=max(c for _, c in uses),  # D5
        in_code=code(gear),
        requirement_ids=tuple(rid for rid, _ in uses),
    )


def _sorted(uses: list[GearUse]) -> tuple[GearUse, ...]:
    return tuple(sorted(uses, key=lambda u: (-u.confidence, u.gear_id)))  # D12


def _totals(rows: tuple[RequirementCoverage, ...]) -> Totals:
    return Totals(
        requirements=len(rows),
        fr=_counts(r.coverage for r in rows if r.kind == "fr"),
        nfr=_counts(r.coverage for r in rows if r.kind == "nfr"),
    )


def _counts(coverages: Iterable[Coverage]) -> CoverageCounts:
    n = Counter(coverages)
    return CoverageCounts(
        covered=n["covered"],
        partial=n["partial"],
        gap=n["gap"],
        clarification_needed=n["clarification_needed"],
        not_assessed=n["not_assessed"],
    )


# --- D11: bad input fails loud ----------------------------------------------------------------


def _check_inputs(
    requirements: Sequence[Requirement],
    gears: Mapping[str, Gear],
    shortlist: Mapping[str, Sequence[str]],
    matches: Sequence[Match],
) -> dict[str, list[Match]]:
    """The matches must equal the shortlist exactly; returns them per requirement, in gear order."""
    req_ids = [r.id for r in requirements]
    _no_duplicates("duplicate_requirement", req_ids)
    _same_set("shortlist", set(req_ids), set(shortlist))
    expected: set[tuple[str, str]] = set()
    for rid, candidates in shortlist.items():
        _no_duplicates("duplicate_candidate", [f"{rid} -> {g}" for g in candidates])
        unknown = sorted(set(candidates) - gears.keys())
        if unknown:
            raise ReportInputError("unknown_gear", f"{rid}: {_names(unknown)}")
        expected |= {(rid, g) for g in candidates}
    pairs = [(m.requirement_id, m.gear_id) for m in matches]
    _no_duplicates("duplicate_match", [f"{r} -> {g}" for r, g in pairs])
    missing = sorted(f"{r} -> {g}" for r, g in expected - set(pairs))
    if missing:
        raise ReportInputError("missing_match", _names(missing))
    extra = sorted(f"{r} -> {g}" for r, g in set(pairs) - expected)
    if extra:
        raise ReportInputError("unexpected_match", _names(extra))
    grouped: dict[str, list[Match]] = {rid: [] for rid in req_ids}
    for m in sorted(matches, key=lambda m: m.gear_id):
        grouped[m.requirement_id].append(m)
    return grouped


def _no_duplicates(kind: str, items: list[str]) -> None:
    repeated = sorted(i for i, n in Counter(items).items() if n > 1)
    if repeated:
        raise ReportInputError(kind, _names(repeated))


def _same_set(what: str, want: set[str], got: set[str]) -> None:
    if want - got:
        raise ReportInputError(f"{what}_missing_requirement", _names(sorted(want - got)))
    if got - want:
        raise ReportInputError("unknown_requirement", _names(sorted(got - want)))


def _names(items: list[str]) -> str:
    shown = ", ".join(items[:_SHOWN])
    return shown + (f" (+{len(items) - _SHOWN} more)" if len(items) > _SHOWN else "")
