"""T2: `load_spec` on real bundles (regression, A5b) and on small built ones (design note §4-§7)."""

import hashlib
import json
import re
from pathlib import Path

import pytest

from gears_matcher.spec import NotATemplate, Spec, SpecError, load_documents, load_spec
from gears_matcher.spec import bundle as bundle_module
from gears_matcher.spec.markdown import blank_hidden

FIXTURES = Path(__file__).parent / "fixtures" / "spec"
STUDIO = FIXTURES / "bundle-studio"
INSIGHT = FIXTURES / "bundle-insight"
MINI_CHAT = FIXTURES / "bundle-mini-chat"
TODO = FIXTURES / "todo-app" / "PRD.md"
STUDIO_PRD = STUDIO / "constructor-studio" / "specs" / "docs" / "prd" / "constructor-studio.md"


def _by_id(spec: Spec) -> dict[str, str]:
    return {r.id: r.text for r in spec.requirements}


# --- regression: the real specs ---------------------------------------------------------------


def test_todo_app_single_file() -> None:
    spec = load_spec(TODO)
    assert (spec.product_id, spec.name, spec.repository, spec.commit) == (
        "todo-app",
        "PRD - Todo App",
        None,
        None,
    )
    found = [
        (q.id.removeprefix("cpt-examples-todo-app-"), q.kind, q.must_level, q.priority)
        for q in spec.requirements
    ]
    assert found == [
        ("fr-create-task", "fr", "MUST", "p1"),
        ("fr-complete-task", "fr", "MUST", "p1"),
        ("fr-delete-task", "fr", "MUST", "p1"),
        ("fr-changes-feed", "fr", "MUST", "p1"),
        ("fr-filter-tasks", "fr", "MUST", "p2"),
        ("nfr-response-time", "nfr", "MUST", "p1"),
        ("nfr-data-persistence", "nfr", "MUST", "p1"),
        ("nfr-offline-support", "nfr", "MUST", "p1"),
    ]


def _section_lines(path: Path, heading: re.Pattern[str]) -> list[str]:
    """The non-trivial lines of each `## ...` section whose title matches `heading`."""
    lines: list[str] = []
    inside = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            inside = heading.search(line) is not None
        elif inside and len(line.strip()) > 20:
            lines.append(line.strip())
    return lines


# --- built bundles: every input status and every error ----------------------------------------

PRD = "#### One\n\n- **ID**: `cpt-demo-fr-one`\n\nThe system MUST work.\n"


def _bundle(
    tmp_path: Path,
    files: dict[str, str | bytes],
    overrides: dict[str, dict[str, object]] | None = None,
) -> Path:
    """A bundle folder with these files and a manifest whose hashes match (unless overridden)."""
    entries = []
    for name, content in files.items():
        data = content.encode() if isinstance(content, str) else content
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_bytes(data)
        entry: dict[str, object] = {"path": name, "sha256": hashlib.sha256(data).hexdigest()}
        entry["formal_spec"] = not name.startswith("notes/")
        entry.update((overrides or {}).get(name, {}))
        entries.append(entry)
    product = {"id": "demo", "name": "Demo", "files": entries}
    (tmp_path / "manifest.json").write_text(json.dumps({"products": [product]}), encoding="utf-8")
    return tmp_path


def test_every_document_gets_a_status_and_a_reason(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        {
            "PRD.md": PRD,
            "notes/README.md": "# Notes\n",
            "feature/login.md": "# Feature: Login\n\nUsers log in.\n",
            "DESIGN.md": "# Design\n",
            "specs/DECOMPOSITION.md": "# Decomposition\n",
            "docs/ADR/0001-x.md": "# ADR\n",
            "docs/design/thing.md": "---\ntype: design\nstatus: accepted\n---\n\n# Thing\n",
            "notes/IDS.md": "#### Two\n\n- **ID**: `cpt-demo-nfr-two`\n\nFast.\n",
        },
    )
    spec = load_spec(bundle)
    status = {d.path: (d.status, d.requirements, d.reason) for d in spec.inputs}
    build = ("skipped", 0, "describes the build, not the product (D3)")
    assert status == {
        "PRD.md": ("read", 1, "defines 1 CF requirement"),
        "notes/README.md": ("skipped", 0, "supporting document (not a formal spec)"),
        "feature/login.md": ("handed-to-t8", 0, "formal spec without CF requirement IDs"),
        "DESIGN.md": build,
        "specs/DECOMPOSITION.md": build,
        "docs/ADR/0001-x.md": build,
        "docs/design/thing.md": build,
        "notes/IDS.md": ("read", 1, "defines 1 CF requirement"),  # D1: any document
    }
    r = spec.report
    assert (r.read, r.handed_to_t8, r.skipped, r.errors) == (2, 1, 5, ())
    assert [q.id for q in spec.requirements] == [
        "cpt-demo-fr-one",
        "cpt-demo-nfr-two",
    ]  # sorted by path


@pytest.mark.parametrize(
    ("files", "overrides", "kind", "status"),
    [
        ({}, {}, "missing_file", "skipped"),
        ({"x.md": "# X\n"}, {"x.md": {"sha256": "0" * 64}}, "hash_mismatch", "handed-to-t8"),
        ({"x.md": b"\xff\xfe bad"}, {}, "not_utf8", "skipped"),
    ],
)
def test_a_bundle_that_is_not_what_it_claims_is_an_error(
    tmp_path: Path,
    files: dict[str, str | bytes],
    overrides: dict[str, dict[str, object]],
    kind: str,
    status: str,
) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD, **files}, overrides)
    if not files:
        manifest = json.loads((bundle / "manifest.json").read_text())
        manifest["products"][0]["files"].append({"path": "gone.md", "sha256": "0" * 64})
        (bundle / "manifest.json").write_text(json.dumps(manifest))
    spec = load_spec(bundle)
    (error,) = spec.report.errors
    assert error.kind == kind
    assert spec.inputs[-1].status == status
    assert spec.report.requirements == 1  # the good document is still read


def test_a_path_that_leaves_the_bundle_is_not_read(tmp_path: Path) -> None:
    (tmp_path / "outside.md").write_text(PRD, encoding="utf-8")
    bundle = _bundle(tmp_path / "b", {"PRD.md": PRD})
    manifest = json.loads((bundle / "manifest.json").read_text())
    manifest["products"][0]["files"].append({"path": "../outside.md"})
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    spec = load_spec(bundle)
    assert [e.kind for e in spec.report.errors] == ["unsafe_path"]
    assert spec.report.requirements == 1


def test_a_duplicate_id_is_an_error_and_both_are_kept(tmp_path: Path) -> None:
    spec = load_spec(_bundle(tmp_path, {"a.md": PRD, "b.md": PRD.replace("work", "rest")}))
    assert _by_id(spec) == {
        "cpt-demo-fr-one": "The system MUST work.",
        "cpt-demo-fr-one--2": "The system MUST rest.",
    }
    (error,) = spec.report.errors
    assert (error.kind, error.where) == ("duplicate_id", "b.md:3")


def test_a_byte_order_mark_is_not_part_of_the_text(tmp_path: Path) -> None:
    spec = load_spec(_bundle(tmp_path, {"PRD.md": "\ufeff" + PRD}))
    assert [q.title for q in spec.requirements] == ["One"]  # the first line is still a heading


def test_requirements_are_ordered_by_file_path_not_manifest_order(tmp_path: Path) -> None:
    second = PRD.replace("cpt-demo-fr-one", "cpt-demo-fr-two")
    spec = load_spec(_bundle(tmp_path, {"z.md": second, "a.md": PRD}))
    assert [q.id for q in spec.requirements] == ["cpt-demo-fr-one", "cpt-demo-fr-two"]
    assert [d.path for d in spec.inputs] == ["z.md", "a.md"]  # inputs keep the manifest's order


def test_no_cf_requirement_anywhere_is_not_a_template(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path, {"spec.md": "# Free-form\n\nUsers MUST log in.\n"})
    with pytest.raises(NotATemplate) as caught:
        load_spec(bundle)
    assert caught.value.paths == ("spec.md",)
    assert "T8" in str(caught.value)
    with pytest.raises(NotATemplate):
        load_spec(bundle / "spec.md")


def test_a_product_folder_inside_a_bundle(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path, {"demo/PRD.md": PRD})
    assert load_spec(bundle / "demo").product_id == "demo"


def test_choosing_a_product_from_a_manifest_with_several(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD})
    manifest = json.loads((bundle / "manifest.json").read_text())
    other = {"id": "other", "name": "Other", "files": []}
    manifest["products"].append(other)
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    assert load_spec(bundle, "demo").name == "Demo"
    with pytest.raises(SpecError, match="choose one with --product; the manifest has: demo, other"):
        load_spec(bundle)
    with pytest.raises(SpecError, match="no product 'nope'"):
        load_spec(bundle, "nope")


@pytest.mark.parametrize(
    "manifest", ["not json", '{"products": "no"}', '{"products": [{"id": "x"}]}', b"\xff"]
)
def test_an_unusable_manifest(tmp_path: Path, manifest: str | bytes) -> None:
    raw = manifest.encode() if isinstance(manifest, str) else manifest
    (tmp_path / "manifest.json").write_bytes(raw)
    with pytest.raises(SpecError, match="not a usable manifest"):
        load_spec(tmp_path)


def test_a_folder_without_a_manifest(tmp_path: Path) -> None:
    with pytest.raises(SpecError, match=r"no manifest\.json"):
        load_spec(tmp_path / "empty")


def test_a_symlink_that_leaves_the_bundle_is_not_read(tmp_path: Path) -> None:
    (tmp_path / "outside.md").write_text(PRD, encoding="utf-8")
    bundle = _bundle(tmp_path / "b", {"PRD.md": PRD})
    (bundle / "link.md").symlink_to(tmp_path / "outside.md")
    manifest = json.loads((bundle / "manifest.json").read_text())
    manifest["products"][0]["files"].append({"path": "link.md"})
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    assert [e.kind for e in load_spec(bundle).report.errors] == ["unsafe_path"]


def test_an_unreadable_file_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD, "locked.md": PRD.replace("one", "two")})
    read_bytes = Path.read_bytes

    def refuse(self: Path) -> bytes:
        if self.name == "locked.md":
            raise PermissionError(13, "Permission denied")
        return read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", refuse)
    spec = load_spec(bundle)
    (error,) = spec.report.errors
    assert (error.kind, error.message) == ("unreadable", "cannot be read (Permission denied)")
    assert spec.inputs[-1].status == "skipped"


def test_a_single_file_that_is_not_utf8_is_an_input_error(tmp_path: Path) -> None:
    (tmp_path / "PRD.md").write_bytes(b"\xff\xfe" + PRD.encode())
    with pytest.raises(SpecError, match="not UTF-8") as caught:
        load_spec(tmp_path / "PRD.md")
    assert not isinstance(caught.value, NotATemplate)


def test_a_file_over_the_size_limit_is_not_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD, "big.md": PRD + "x" * 2000})
    monkeypatch.setattr(bundle_module, "MAX_BYTES", 1000)
    spec = load_spec(bundle)
    (error,) = spec.report.errors
    assert (error.kind, error.where) == ("too_large", "big.md")
    assert spec.inputs[-1].status == "skipped"
    monkeypatch.setattr(bundle_module, "MAX_BYTES", 10)
    with pytest.raises(SpecError, match="larger than 10 bytes"):
        load_spec(bundle)  # the manifest itself


def test_a_file_without_a_sha256_is_read_but_flagged_unverified(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD})
    manifest = json.loads((bundle / "manifest.json").read_text())
    del manifest["products"][0]["files"][0]["sha256"]
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    spec = load_spec(bundle)
    assert spec.report.requirements == 1
    assert [(i.severity, i.kind, i.where) for i in spec.report.issues] == [
        ("info", "no_sha256", "PRD.md")
    ]


# --- load_documents: the hand-over to T8 (T8 note §4.1) ------------------------------------------

PROSE = "# Notes\n\nUsers can sign in.\nThey must not share accounts.\n"


def test_a_free_form_file_is_a_spec_with_no_requirement_and_one_handed_document(
    tmp_path: Path,
) -> None:
    file = tmp_path / "idea.md"
    file.write_text("\ufeff" + PROSE, encoding="utf-8")
    loaded = load_documents(file)
    assert loaded.spec.requirements == ()
    assert [(d.path, d.text) for d in loaded.handed] == [(file.as_posix(), PROSE)]  # BOM gone
    (row,) = loaded.spec.inputs
    assert (row.status, row.requirements, row.reason) == (
        "handed-to-t8",
        0,
        "no CF requirement IDs",
    )
    assert loaded.spec.report.handed_to_t8 == 1
    with pytest.raises(NotATemplate):  # load_spec is unchanged
        load_spec(file)


def test_a_single_file_named_like_a_design_document_is_handed_over_all_the_same(
    tmp_path: Path,
) -> None:
    (tmp_path / "DESIGN.md").write_text(PROSE, encoding="utf-8")
    assert [d.text for d in load_documents(tmp_path / "DESIGN.md").handed] == [PROSE]


def test_a_single_cf_file_hands_nothing_over() -> None:
    loaded = load_documents(TODO)
    assert loaded.handed == ()
    assert loaded.spec == load_spec(TODO)


def test_a_bundle_hands_over_only_the_formal_specs_without_cf_ids(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        {
            "PRD.md": PRD,
            "z-feature.md": "# Z\n\nSomething.\n",
            "a-feature.md": PROSE,
            "notes/README.md": "# Notes\n",
            "DESIGN.md": "# Design\n",
        },
    )
    loaded = load_documents(bundle)
    assert [d.path for d in loaded.handed] == ["a-feature.md", "z-feature.md"]  # sorted by path
    assert loaded.handed[0].text == PROSE
    assert loaded.spec == load_spec(bundle)  # the same spec, requirements and rows included


def test_a_bundle_with_no_cf_requirement_is_not_an_error_here(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path, {"spec.md": PROSE})
    loaded = load_documents(bundle)
    assert loaded.spec.requirements == ()
    assert [d.path for d in loaded.handed] == ["spec.md"]
    with pytest.raises(NotATemplate):
        load_spec(bundle)


def test_a_design_document_is_not_handed_over_even_when_it_is_the_only_spec(
    tmp_path: Path,
) -> None:
    """The fallback of T8 D7 waits for the PM's answer (question 1): until then the hand-over is
    exactly what T2 says is handed over."""
    loaded = load_documents(_bundle(tmp_path, {"DESIGN.md": PROSE}))
    assert loaded.handed == ()
    assert loaded.spec.inputs[0].status == "skipped"


def test_a_document_that_fails_its_hash_is_not_handed_over(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        {"PRD.md": PRD, "bad.md": PROSE, "good.md": PROSE + "More.\n"},
        {"bad.md": {"sha256": "0" * 64}},
    )
    loaded = load_documents(bundle)
    assert [d.path for d in loaded.handed] == ["good.md"]
    rows = {d.path: (d.status, d.reason) for d in loaded.spec.inputs}
    assert rows["bad.md"] == (
        "skipped",
        "not handed to T8: SHA-256 differs from the manifest",
    )
    assert [e.kind for e in loaded.spec.report.errors] == ["hash_mismatch"]  # still reported
    assert load_spec(bundle).inputs[1].status == "handed-to-t8"  # load_spec says what it did


def test_a_cf_id_in_a_never_read_section_does_not_stop_the_hand_over(tmp_path: Path) -> None:
    """Sanjeev's case on #77: a free-form PRD with one CF ID in its Traceability list. The error
    is reported, but the document is still handed over, and T8 never sees the blanked section."""
    text = (
        "# Product\n\n## Requirements\n\nUsers can sign in with their company account.\n\n"
        "## 14. Traceability\n\n- **ID**: `cpt-demo-fr-signin` is covered by the sign-in gear\n"
    )
    bundle = _bundle(tmp_path, {"prd.md": text})
    loaded = load_documents(bundle)
    (row,) = loaded.spec.inputs
    assert (row.status, row.reason) == ("handed-to-t8", "formal spec without CF requirement IDs")
    assert [d.path for d in loaded.handed] == ["prd.md"]
    assert [e.kind for e in loaded.spec.report.errors] == ["requirement_in_skipped_section"]
    assert "cpt-demo-fr-signin" not in blank_hidden(loaded.handed[0].text)


def test_only_a_hash_mismatch_withholds_a_handed_document(tmp_path: Path) -> None:
    bundle = _bundle(
        tmp_path,
        {"bad.md": PROSE, "trace.md": PROSE + "\n## Traceability\n\n- **ID**: `cpt-x-fr-y`\n"},
        {"bad.md": {"sha256": "0" * 64}},
    )
    loaded = load_documents(bundle)
    assert [d.path for d in loaded.handed] == ["trace.md"]
    rows = {d.path: d.status for d in loaded.spec.inputs}
    assert rows == {"bad.md": "skipped", "trace.md": "handed-to-t8"}
    kinds = sorted(e.kind for e in loaded.spec.report.errors)
    assert kinds == ["hash_mismatch", "requirement_in_skipped_section"]


def test_a_handed_document_is_the_text_the_manifest_hash_was_checked_against(
    tmp_path: Path,
) -> None:
    bundle = _bundle(tmp_path, {"PRD.md": PRD, "feature.md": PROSE})
    manifest = json.loads((bundle / "manifest.json").read_text())
    expected = {f["path"]: f["sha256"] for f in manifest["products"][0]["files"]}
    (doc,) = load_documents(bundle).handed
    assert hashlib.sha256(doc.text.encode()).hexdigest() == expected["feature.md"]


def test_load_documents_fails_where_load_spec_fails(tmp_path: Path) -> None:
    with pytest.raises(SpecError, match=r"no manifest\.json"):
        load_documents(tmp_path)
    bundle = _bundle(tmp_path / "b", {"PRD.md": PRD})
    with pytest.raises(SpecError, match="no product 'nope'"):
        load_documents(bundle, "nope")
    bad = tmp_path / "bad.md"
    bad.write_bytes(b"\xff\xfe not utf-8")
    with pytest.raises(SpecError, match="not UTF-8"):
        load_documents(bad)


def test_a_product_folder_inside_a_bundle_hands_over_its_documents(tmp_path: Path) -> None:
    root = _bundle(tmp_path, {"feature.md": PROSE})
    manifest = json.loads((root / "manifest.json").read_text())
    manifest["products"][0]["id"] = "demo"
    (root / "manifest.json").write_text(json.dumps(manifest))
    (root / "demo").mkdir()
    assert [d.path for d in load_documents(root / "demo").handed] == ["feature.md"]
