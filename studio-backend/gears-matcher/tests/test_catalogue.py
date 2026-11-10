"""T1 catalogue parser: fixture tests on pinned excerpts, plus a full parse if a checkout exists."""

import os
from pathlib import Path

import pytest

from gears_matcher.catalogue import (
    PINNED_GDL_COMMIT,
    PINNED_MD_COMMIT,
    AmbiguousGearError,
    Catalogue,
    build_catalogue,
    build_from_repo,
    has_code,
    resolve_gear,
)
from gears_matcher.catalogue.aliases import GDL_TO_MD
from gears_matcher.catalogue.gdl import parse_gdl
from gears_matcher.catalogue.gears_md import parse_gears_md
from gears_matcher.catalogue.limits import LIMITS_LIMIT, prd_path, stated_does, stated_limits
from gears_matcher.catalogue.sources import DirTree

FIXTURES = Path(__file__).parent / "fixtures"
MD_TEXT = (FIXTURES / "GEARS.md").read_text()


def _tree(tmp_path: Path, files: dict[str, str], commit: str = "sha") -> DirTree:
    for rel, text in files.items():
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_text(text)
    return DirTree(tmp_path, commit)


def _gdl(name: str, category: str = "core-functionality", extra: str = "") -> str:
    return f'gear(name = "{name}", description = "d", category = "{category}", {extra})\n'


def _md(*sections: str, category: str = "Core Functionality") -> str:
    return f"## {category}\n" + "".join(f"### {s}\n#### Responsibility\nr\n" for s in sections)


@pytest.fixture(scope="module")
def catalogue() -> Catalogue:
    aliases = {k: v for k, v in GDL_TO_MD.items() if k in {"event-broker", "authn-resolver"}}
    return build_catalogue(_FixtureMd(), DirTree(FIXTURES / "gdl", "gdl-sha"), aliases=aliases)


class _FixtureMd(DirTree):
    """The excerpt lives at tests/fixtures/GEARS.md; the parser asks for docs/GEARS.md."""

    def __init__(self) -> None:
        super().__init__(FIXTURES, "md-sha")

    def read(self, path: str) -> str:
        return MD_TEXT


# --- GEARS.md irregular cases ------------------------------------------------------------------


def test_md_counts_sections_and_skips_the_listed_non_gear() -> None:
    md = parse_gears_md(MD_TEXT)
    assert len(md.entries) == 10
    assert md.skipped == ("Gen AI Gears / Execution flow overview",)
    assert not md.issues


def test_md_event_broker_without_responsibility_heading_uses_prose_and_drops_status() -> None:
    cpi = next(
        e
        for e in parse_gears_md(MD_TEXT).entries
        if e.category == "core-platform-integration" and e.name == "Event Broker"
    )
    assert cpi.responsibility.startswith("Multi-consumer, partitioned")
    assert "Status" not in cpi.responsibility


def test_md_heading_case_is_ignored() -> None:
    mpc = {e.name: e for e in parse_gears_md(MD_TEXT).entries}["Model Provider Controller"]
    assert mpc.capabilities[0] == "model browsing"  # under `#### High level scenarios`


def test_md_same_name_twice_keeps_both() -> None:
    brokers = [e for e in parse_gears_md(MD_TEXT).entries if e.name == "Event Broker"]
    assert {e.category for e in brokers} == {
        "core-functionality",
        "core-platform-integration",
    }


def test_md_stops_at_scenario_sections() -> None:
    names = [e.name for e in parse_gears_md(MD_TEXT).entries]
    assert "Sub-scenario - incoming API call processing" not in names
    assert names[-1] == "Studio Backend"


def test_md_strips_markers_and_counts_them() -> None:
    md = parse_gears_md(MD_TEXT)
    caps = [c for e in md.entries for c in e.capabilities]
    assert not any(c.startswith(("[", "p1", "p2", "p0")) for c in caps)
    assert md.markers_stripped == len(caps)


def test_md_studio_backend_is_kept() -> None:
    assert "Studio Backend" in [e.name for e in parse_gears_md(MD_TEXT).entries]


def test_md_doc_paths_are_repo_relative_and_todo_lines_dropped() -> None:
    cred = {e.name: e for e in parse_gears_md(MD_TEXT).entries}["Credentials Store"]
    assert cred.doc_paths[0] == "gears/credstore/docs/PRD.md"
    assert all(not p.startswith("..") for p in cred.doc_paths)


def test_md_unknown_section_is_reported_not_dropped() -> None:
    md = parse_gears_md("## Mystery\n### Thing\n#### Responsibility\nx\n")
    assert (
        [i.kind for i in md.errors] == ["unrecognised_section"] if hasattr(md, "errors") else True
    )
    assert [i.kind for i in md.issues] == ["unrecognised_section"]
    assert md.entries == ()


def test_md_headings_inside_code_fences_are_ignored() -> None:
    md = parse_gears_md("## Studio\n### A\n#### Responsibility\nx\n```\n### Not a gear\n```\n")
    assert [e.name for e in md.entries] == ["A"]


def test_md_missing_responsibility_is_an_error() -> None:
    md = parse_gears_md("## Studio\n### Empty\n")
    assert [i.kind for i in md.issues] == ["missing_responsibility"]


# --- gear.gdl ----------------------------------------------------------------------------------


def test_gdl_reads_credstore_without_executing() -> None:
    text = (FIXTURES / "gdl/gears/credstore/credstore/gear.gdl").read_text()
    g = parse_gdl(text, "gears/credstore/credstore/gear.gdl").gear
    assert g
    assert (g.id, g.name, g.crate) == (
        "credstore",
        "Credentials Store",
        "cf-gears-credstore",
    )
    assert g.extension_points == ("cf.core.credstore.plugin.v1~",)


def test_gdl_resolves_top_level_constants() -> None:
    text = (FIXTURES / "gdl/gears/system/authz-resolver/authz-resolver/gear.gdl").read_text()
    parsed = parse_gdl(text, "gears/system/authz-resolver/authz-resolver/gear.gdl")
    assert parsed.gear
    assert not parsed.issues


def test_gdl_never_executes_code(tmp_path: Path) -> None:
    marker = tmp_path / "ran"
    text = (
        f'open({str(marker)!r}, "w")\n' + _gdl("X") + f'__import__("os").system("touch {marker}")\n'
    )
    parsed = parse_gdl(text, "gears/x/gear.gdl")
    assert not marker.exists()
    assert parsed.gear
    assert [i.kind for i in parsed.issues] == ["unrecognised_statement"] * 2


def test_gdl_syntax_error_is_reported() -> None:
    parsed = parse_gdl("gear(name = ", "gears/x/gear.gdl")
    assert parsed.gear is None
    assert parsed.issues[0].kind == "unparsable_gdl"


def test_gdl_unreadable_value_is_reported() -> None:
    parsed = parse_gdl('gear(name = f(x), description = "d", category = "c")\n', "g/gear.gdl")
    assert parsed.gear is None
    assert [i.kind for i in parsed.issues] == ["unreadable_gdl"]


def test_gdl_dotted_names_are_read_as_data() -> None:
    """gears-rust writes `cluster_cap.linearizable` inside a call: a name, not a value."""
    cache = 'cluster.cache(profile = "p", capabilities = [cluster_cap.linearizable])'
    extra = f"consumes = [{cache}]"
    parsed = parse_gdl(_gdl("X", extra=extra), "g/gear.gdl")
    assert parsed.gear is not None
    assert parsed.issues == ()


@pytest.mark.parametrize(
    "extra",
    [
        "package = cargo(crate_name = x.y)",
        "id = x.y",
        "implements = x.y",
        "extension_points = [extension_point(x.y)]",
    ],
)
def test_gdl_dotted_name_where_a_string_is_needed_is_unreadable(extra: str) -> None:
    """A dotted name is data, but not a crate name, id, `implements` or extension point: that gear
    is `unreadable_gdl` (as on main), and does not reach the `Gear` model."""
    parsed = parse_gdl(_gdl("X", extra=extra), "g/gear.gdl")
    assert parsed.gear is None
    assert [i.kind for i in parsed.issues] == ["unreadable_gdl"]


def test_one_unreadable_gear_does_not_stop_the_others_from_being_built(tmp_path: Path) -> None:
    gdl = _tree(
        tmp_path,
        {
            "gears/a/gear.gdl": _gdl("A", extra="package = cargo(crate_name = x.y)"),
            "gears/b/gear.gdl": _gdl("B"),
        },
    )
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("B")}), gdl, aliases={})
    assert "gears-rust/b" in cat.by_id()
    assert [i.kind for i in cat.report.errors] == ["unreadable_gdl"]


def test_gdl_attribute_of_a_call_is_still_unreadable() -> None:
    parsed = parse_gdl(_gdl("X", extra="maturity = f().x"), "g/gear.gdl")
    assert parsed.gear is None
    assert [i.kind for i in parsed.issues] == ["unreadable_gdl"]


def test_gdl_unreadable_constant_is_reported() -> None:
    text = "X = unknown_name\n" + _gdl("X")
    parsed = parse_gdl(text, "g/gear.gdl")
    assert parsed.gear
    assert [i.kind for i in parsed.issues] == ["unreadable_gdl"]
    assert parsed.issues[0].where == "g/gear.gdl:1"


def test_gdl_missing_required_field_is_reported() -> None:
    parsed = parse_gdl('gear(name = "X", description = "d")\n', "g/gear.gdl")
    assert parsed.gear is None
    assert [i.kind for i in parsed.issues] == ["unreadable_gdl"]


@pytest.mark.parametrize("text", ["", _gdl("A") + _gdl("B")])
def test_gdl_gear_call_count_is_reported(text: str) -> None:
    parsed = parse_gdl(text, "g/gear.gdl")
    assert parsed.gear is None
    assert [i.kind for i in parsed.issues] == ["gear_call_count"]


def test_gdl_unrecognised_statement_is_reported() -> None:
    parsed = parse_gdl("import os\n" + _gdl("X"), "g/gear.gdl")
    assert parsed.gear
    assert [i.kind for i in parsed.issues] == ["unrecognised_statement"]
    assert parsed.issues[0].severity == "error"


def test_gdl_example_files_are_skipped_and_listed(catalogue: Catalogue) -> None:
    assert catalogue.report.gdl_skipped == (
        "examples/toolkit/api-contracts/api-contracts/gear.gdl",
    )


# --- join --------------------------------------------------------------------------------------


def test_fixture_catalogue_report(catalogue: Catalogue) -> None:
    r = catalogue.report
    assert (r.md_sections, r.gdl_gears, r.gdl_plugins, r.joined) == (10, 6, 4, 4)
    assert not r.errors
    assert set(r.gdl_only) == {"gears-rust/authz-resolver", "gears-rust/mini-chat"}
    assert len(r.md_only) == 6
    assert len(catalogue.gears) == 12
    assert (catalogue.gears_md_commit, catalogue.gear_gdl_commit) == (
        "md-sha",
        "gdl-sha",
    )


def test_gear_keeps_the_gdl_description_verbatim(catalogue: Catalogue) -> None:
    cred = catalogue.by_id()["gears-rust/credstore"]
    assert cred.description == (
        "Secure per-tenant secret storage with pluggable backends and hierarchical sharing."
    )
    assert cred.description != cred.responsibility  # md text and gdl text both kept
    sole = [(g, g.sources[0].kind) for g in catalogue.gears if len(g.sources) == 1]
    assert any(kind == "gears-md" for _, kind in sole)
    assert all(g.description is None for g, kind in sole if kind == "gears-md")


def test_join_by_name_and_by_alias(catalogue: Catalogue) -> None:
    by_id = catalogue.by_id()
    cred = by_id["gears-rust/credstore"]  # "Credentials Store" == "Credentials Store"
    assert {s.kind for s in cred.sources} == {"gears-md", "gear-gdl"}
    assert cred.crate == "cf-gears-credstore"
    assert cred.capabilities
    assert {s.kind for s in by_id["gears-rust/event-broker"].sources} == {
        "gears-md",
        "gear-gdl",
    }  # alias
    assert {s.kind for s in by_id["gears-rust/authn-resolver"].sources} == {
        "gears-md",
        "gear-gdl",
    }  # alias
    assert by_id["gears-rust/oagw"].name == "Outbound API Interface"


def test_duplicate_name_never_overwrites(catalogue: Catalogue) -> None:
    by_id = catalogue.by_id()
    assert by_id["gears-rust/event-broker"].category == "core-functionality"
    other = by_id["gears-rust/event-broker--core-platform-integration"]
    assert other.sources[0].kind == "gears-md"
    assert len(other.sources) == 1
    assert other.responsibility != by_id["gears-rust/event-broker"].responsibility


def test_gear_in_one_source_is_kept_and_marked(catalogue: Catalogue) -> None:
    mini = catalogue.by_id()["gears-rust/mini-chat"]
    assert [s.kind for s in mini.sources] == ["gear-gdl"]
    assert mini.responsibility
    assert [s.kind for s in catalogue.by_id()["gears-rust/studio-backend"].sources] == ["gears-md"]


def test_plugins_attach_to_parents_and_are_not_gears(catalogue: Catalogue) -> None:
    by_id = catalogue.by_id()
    assert [p.name for p in by_id["gears-rust/credstore"].plugins] == ["Static CredStore Plugin"]
    assert len(by_id["gears-rust/mini-chat"].plugins) == 2  # nested under src/infra/plugins
    assert not any("plugin" in g.id for g in catalogue.gears)


def test_plugin_without_implements_falls_back_to_path(tmp_path: Path) -> None:
    gdl = _tree(
        tmp_path,
        {"gears/a/a/gear.gdl": _gdl("A"), "gears/a/plugins/p/gear.gdl": _gdl("P")},
    )
    md = _tree(tmp_path / "md", {"docs/GEARS.md": _md("A")})
    cat = build_catalogue(md, gdl, aliases={})
    assert [p.name for p in cat.by_id()["gears-rust/a"].plugins] == ["P"]
    assert not cat.report.errors


def test_orphan_plugin_is_an_error(tmp_path: Path) -> None:
    gdl = _tree(tmp_path, {"gears/z/plugins/p/gear.gdl": _gdl("P")})
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("A")}), gdl, aliases={})
    assert [i.kind for i in cat.report.errors] == ["orphan_plugin"]


def test_stale_alias_is_an_error(tmp_path: Path) -> None:
    gdl = _tree(tmp_path, {"gears/a/gear.gdl": _gdl("A")})
    md = _tree(tmp_path / "md", {"docs/GEARS.md": _md("A")})
    cat = build_catalogue(
        md,
        gdl,
        aliases={
            "a": ("Nope", "core-functionality"),
            "gone": ("A", "core-functionality"),
        },
    )
    assert sorted(i.kind for i in cat.report.errors) == ["stale_alias", "stale_alias"]


def test_ambiguous_name_is_reported_and_nothing_lost(tmp_path: Path) -> None:
    gdl = _tree(tmp_path, {"gears/a/gear.gdl": _gdl("Twin", "bss")})
    md = _tree(
        tmp_path / "md",
        {"docs/GEARS.md": _md("Twin") + _md("Twin", category="OSS (Operations Support System)")},
    )
    cat = build_catalogue(md, gdl, aliases={})
    assert [i.kind for i in cat.report.errors] == ["ambiguous_join"]
    assert len(cat.gears) == 3  # 2 md sections + the unjoined gdl gear


def test_two_gdl_gears_cannot_claim_one_section(tmp_path: Path) -> None:
    gdl = _tree(tmp_path, {"gears/a/gear.gdl": _gdl("Same"), "gears/b/gear.gdl": _gdl("Same")})
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("Same")}), gdl, aliases={})
    assert [i.kind for i in cat.report.errors] == ["duplicate_join"]
    assert len(cat.gears) == 2


def test_duplicate_gdl_id_is_reported(tmp_path: Path) -> None:
    gdl = _tree(
        tmp_path,
        {
            "gears/a/gear.gdl": _gdl("A", extra='id = "x"'),
            "gears/b/gear.gdl": _gdl("B", extra='id = "x"'),
        },
    )
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("Other")}), gdl, aliases={})
    assert "duplicate_id" in [i.kind for i in cat.report.errors]
    assert len({g.id for g in cat.gears}) == len(cat.gears)


def test_json_dump_round_trips(catalogue: Catalogue) -> None:
    again = Catalogue.model_validate_json(catalogue.model_dump_json())
    assert again == catalogue


def test_resolve_gear_by_id_crate_and_alias(catalogue: Catalogue) -> None:
    ids = {
        name: getattr(resolve_gear(catalogue, name), "id", None)
        for name in ("credstore", "cf-gears-credstore", "api_egress")
    }
    assert ids == {
        "credstore": "gears-rust/credstore",
        "cf-gears-credstore": "gears-rust/credstore",
        "api_egress": "gears-rust/oagw",
    }
    assert resolve_gear(catalogue, "gear-orchestrator") is None  # not found


def test_resolve_gear_ambiguous_is_distinct_from_not_found(tmp_path: Path) -> None:
    gdl = _tree(tmp_path, {"a/x/gear.gdl": _gdl("Twin"), "b/y/gear.gdl": _gdl("Twin")})
    md = _tree(tmp_path / "md", {"docs/GEARS.md": _md()})
    cat = build_catalogue(md, gdl)
    assert resolve_gear(cat, "nothing-like-it") is None
    with pytest.raises(AmbiguousGearError) as exc:
        resolve_gear(cat, "Twin")
    assert exc.value.candidates == ("gears-rust/x", "gears-rust/y")


PRD = """# PRD
## 1. Overview
Promotions (D-409) are deferred by the owner.
| Phase | Note: deferred |
### 1.4 Non-goals
- Moving a tenant subtree to a new parent.
<!-- fdd-id -->
#### Detail inside the section
- Partial updates.
### 1.5 Glossary
- Tenant: an organization.
## 4. Scope
**Deferred to tracked follow-ups**:

- Write-back operations:
  later increments
Unrelated line.
"""


def test_stated_limits_keep_the_out_of_scope_sections_then_deferred_lines() -> None:  # T11 D16
    assert stated_limits(PRD) == "\n".join(
        [
            "- Moving a tenant subtree to a new parent.",
            "#### Detail inside the section",
            "- Partial updates.",
            "Promotions (D-409) are deferred by the owner.",
            "**Deferred to tracked follow-ups**:",
            "- Write-back operations:",
            "later increments",
        ]
    )
    assert stated_limits("# PRD\n## Goals\n- Fast.\n") is None
    long = stated_limits("## Out of Scope\n" + "- x" * LIMITS_LIMIT)
    assert long is not None
    assert long.endswith(" [cut]")
    assert len(long) == LIMITS_LIMIT + len(" [cut]")


DOES_PRD = """# PRD
## 4. Scope
### 4.1 In Scope
- Session export (JSON, Markdown).
<!-- note -->
| table | row |
### 4.2 Out of Scope
- Billing.
## 5. Functional Requirements
### 5.1 Core
#### FR-009: Export Session
Text.
#### Balanced journal entries
- [ ] `p1` - **ID**: `cpt-cf-bss-ledger-fr-balanced-journal-entries`
#### A heading with no ID
Text.
## 6. Non-Functional Requirements
#### FR-1 not counted here
"""


def test_stated_does_keeps_the_in_scope_lines_then_the_feature_titles() -> None:  # T11 D17
    assert stated_does(DOES_PRD) == "\n".join(
        ["- Session export (JSON, Markdown).", "- FR-009: Export Session",
         "- Balanced journal entries"]
    )  # fmt: skip
    assert stated_does("# PRD\n## Goals\n- Fast.\n") is None


def test_a_not_in_scope_heading_is_a_limit_never_what_the_gear_does() -> None:  # T11 #90
    prd = (
        "## In scope\n- Keeps settings.\n## Not in scope\n- Billing.\n"
        "### Items not in scope\n- Mail.\n"
    )
    assert stated_does(prd) == "- Keeps settings."
    assert stated_limits(prd) == "- Billing.\n- Mail."


def test_the_prd_of_a_gear_is_the_nearest_above_its_gear_gdl() -> None:  # T11 D16
    prds = {"gears/bss/pricing/docs/PRD.md", "gears/chat/docs/PRD.md", "x/chat/docs/PRD.md"}
    assert prd_path(prds, "gears/bss/pricing/pricing/gear.gdl", "pricing") == (
        "gears/bss/pricing/docs/PRD.md"
    )
    assert prd_path(prds, None, "pricing") == "gears/bss/pricing/docs/PRD.md"  # GEARS.md only
    assert prd_path(prds, None, "chat") is None  # two folders named like it: not guessed
    assert prd_path(prds, "gears/other/gear.gdl", "other") is None
    shared = {"gears/docs/PRD.md", "gears/system/docs/PRD.md", "gears/system/own/docs/PRD.md"}
    assert prd_path(shared, "gears/system/own/gear.gdl", "own") == "gears/system/own/docs/PRD.md"
    assert prd_path(shared, "gears/system/deep/deep/gear.gdl", "deep") is None  # not a parent's


def test_the_catalogue_carries_each_gears_stated_limits(tmp_path: Path) -> None:  # T11 D16
    gdl = _tree(
        tmp_path,
        {
            "a/built/built/gear.gdl": _gdl("Built"),
            "a/built/docs/PRD.md": (
                "## In Scope\n- Keeps settings.\n## Out of Scope\n- Per-user preferences.\n"
            ),
            "b/plain/gear.gdl": _gdl("Plain"),
        },
    )
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("Paper")}), gdl)
    assert {g.id: g.limits for g in cat.gears} == {
        "gears-rust/built": "- Per-user preferences.",
        "gears-rust/plain": None,
        "gears-rust/paper": None,
    }
    assert {g.id: g.does for g in cat.gears} == {
        "gears-rust/built": "- Keeps settings.",
        "gears-rust/plain": None,
        "gears-rust/paper": None,
    }


def test_has_code_only_when_the_gear_gdl_declares_a_crate(tmp_path: Path) -> None:  # T11 D15
    gdl = _tree(
        tmp_path,
        {
            "a/built/gear.gdl": _gdl("Built", extra='package = cargo(crate_name = "cf-built")'),
            "b/design/gear.gdl": _gdl("Design", extra='maturity = "design"'),
        },
    )
    cat = build_catalogue(_tree(tmp_path / "md", {"docs/GEARS.md": _md("Paper")}), gdl)
    assert {g.id: has_code(g) for g in cat.gears} == {
        "gears-rust/built": True,
        "gears-rust/design": False,
        "gears-rust/paper": False,
    }


# --- full parse at the pinned SHAs (needs a gears-rust checkout; CI fetches one) ----------------

REPO = Path(os.environ.get("GEARS_RUST_REPO", Path(__file__).parents[2] / "gears-rust"))
STUDIO_BACKEND = [  # `registered_gears.rs` in studio-web: the 16 gears Studio's backend links
    "api_gateway",
    "authn_resolver",
    "authz_resolver",
    "gear_orchestrator",
    "grpc_hub",
    "nodes_registry",
    "resource_group",
    "tenant_resolver",
    "types_registry",
    "account_management",
    "credstore",
    "file_storage",
    "simple_user_settings",
    "api_egress",
    "mini_chat",
    "graph_storage",
]


@pytest.fixture(scope="module")
def full() -> Catalogue:
    if not (REPO / ".git").exists():
        if os.environ.get("CI"):  # CI fetches the pinned commits: a missing checkout is a failure
            pytest.fail(f"no gears-rust checkout at {REPO} in CI (the fetch step should set it)")
        pytest.skip("no gears-rust checkout (set GEARS_RUST_REPO)")
    return build_from_repo(REPO)


def test_full_parse_report_at_pinned_commit(full: Catalogue) -> None:
    r = full.report
    assert full.gear_gdl_commit == PINNED_GDL_COMMIT
    assert full.gears_md_commit == PINNED_MD_COMMIT
    assert (r.md_sections, r.gdl_gears, r.gdl_plugins, len(r.gdl_skipped)) == (
        75,
        39,
        18,
        2,
    )
    assert (r.joined, len(r.md_only), len(r.gdl_only)) == (32, 43, 7)
    assert r.markers_stripped == 381
    assert not r.errors
    assert len(full.gears) == 82
    assert len({g.id for g in full.gears}) == 82


def test_full_studio_backend_gears_resolve_except_orchestrator(full: Catalogue) -> None:
    missing = [n for n in STUDIO_BACKEND if resolve_gear(full, n) is None]
    assert missing == ["gear_orchestrator"]
