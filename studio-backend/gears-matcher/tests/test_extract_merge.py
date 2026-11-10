"""T8 PR 4: the merge, and what the report and the renderer show of an extraction (design note
§3, D12, D15; #65)."""

import json
from pathlib import Path

import jsonschema
import pytest

from gears_matcher.catalogue.models import Catalogue
from gears_matcher.extract import Extractor, merge
from gears_matcher.judge import StubJudge, judge_requirement
from gears_matcher.judge.llm.schema import ModelOutput
from gears_matcher.models import Clarification, Match
from gears_matcher.render import RunInfo, render
from gears_matcher.report import (
    SCHEMA_FILE,
    SCHEMA_VERSION,
    RunSettings,
    build_report,
    validated_json,
)
from gears_matcher.retrieval import retrieve
from gears_matcher.spec import LoadedSpec, load_documents

ROOT = Path(__file__).parents[1]
CF = "#### One\n\n- **ID**: `cpt-demo-fr-one`\n\nThe system MUST work.\n"
PROSE = (
    "# Notes\n\n- Users can sign in with their company account.\n- Users must not share accounts.\n"
)


class Scripted:
    def __init__(self, reply: object) -> None:
        self.reply = reply
        self.calls = 0

    def complete(
        self, *, system: str, user: str, schema: dict[str, object], timeout_s: float
    ) -> ModelOutput:
        self.calls += 1
        return ModelOutput(text=json.dumps(self.reply), input_tokens=1, output_tokens=1)


REPLY = {
    "items": [
        {"quote": "Users can sign in with their company account.", "kind": "fr"},
        {"quote": "Users must not share accounts", "kind": "fr"},
    ],
    "unclear": [{"topic": "Which account?", "reason": "No provider is named."}],
}


def _bundle(tmp_path: Path, files: dict[str, str]) -> Path:
    entries = []
    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text, encoding="utf-8")
        entries.append({"path": name, "formal_spec": True})
    product = {"id": "demo", "name": "Demo", "files": entries}
    (tmp_path / "manifest.json").write_text(json.dumps({"products": [product]}), encoding="utf-8")
    return tmp_path


def _merged(tmp_path: Path, files: dict[str, str], reply: object = REPLY):  # type: ignore[no-untyped-def]
    loaded = load_documents(_bundle(tmp_path / "b", files))
    extractor = Extractor(Scripted(reply), tmp_path / "c", model="m", max_calls=5)
    result = extractor.extract(loaded.handed)
    return loaded, result, merge(loaded, result)


def test_extracted_requirements_join_t2s_in_path_and_line_order(tmp_path: Path) -> None:
    loaded, result, spec = _merged(tmp_path, {"b-prd.md": CF, "a-notes.md": PROSE})
    assert [(r.source.path, r.origin) for r in spec.requirements] == [
        ("a-notes.md", "extracted"),
        ("a-notes.md", "extracted"),
        ("b-prd.md", "template"),
    ]
    assert len(loaded.spec.requirements) == 1  # the original is untouched
    assert len(result.extracted) == 2
    lines = [r.source.line for r in spec.requirements if r.source.path == "a-notes.md"]
    assert lines == sorted(lines)


def test_the_documents_t8_read_gain_their_counts_and_keep_their_status(tmp_path: Path) -> None:
    _, _, spec = _merged(tmp_path, {"prd.md": CF, "notes.md": PROSE})
    rows = {d.path: d for d in spec.inputs}
    assert rows["prd.md"].extraction is None
    notes = rows["notes.md"]
    assert (notes.status, notes.requirements) == ("handed-to-t8", 2)
    assert notes.extraction is not None
    assert (notes.extraction.kept, notes.extraction.chunks_failed, notes.extraction.incomplete) == (
        2,
        0,
        False,
    )


def test_the_spec_report_counts_all_requirements_but_no_must_level_stays_t2s(
    tmp_path: Path,
) -> None:
    _, _, spec = _merged(tmp_path, {"prd.md": CF, "notes.md": PROSE})
    r = spec.report
    assert (r.requirements, r.fr, r.nfr) == (3, 3, 0)
    assert r.no_must_level == 0  # T2's one requirement says MUST; the two extracted do not count
    assert (r.read, r.handed_to_t8, r.skipped) == (1, 1, 0)


def test_a_free_form_spec_merges_into_a_spec_with_only_extracted_requirements(
    tmp_path: Path,
) -> None:
    _, _, spec = _merged(tmp_path, {"notes.md": PROSE})
    assert {r.origin for r in spec.requirements} == {"extracted"}
    assert spec.report.read == 0


# --- the report ---------------------------------------------------------------------------------


def _report(spec, catalogue: Catalogue, extraction: str | None, asked=()):  # type: ignore[no-untyped-def]
    shortlists = retrieve(spec.requirements, catalogue, k=3)
    shortlist = {rid: [c.gear_id for c in s.candidates] for rid, s in shortlists.items()}
    gears = {g.id: g for g in catalogue.gears}
    matches: list[Match] = []
    for req in spec.requirements:
        matches += judge_requirement(StubJudge(), req, [gears[g] for g in shortlist[req.id]])
    settings = RunSettings(judge="stub", shortlist="tf-idf, k=3", tau=0.5, extraction=extraction)
    return build_report(
        spec, catalogue, shortlist, matches, settings=settings, clarifications=asked
    )


def test_the_report_marks_extracted_requirements_and_says_how_they_were_read(
    tmp_path: Path, fixture_catalogue: Catalogue
) -> None:
    _, result, spec = _merged(tmp_path, {"prd.md": CF, "notes.md": PROSE})
    report = _report(spec, fixture_catalogue, "llm: m, prompt v0", result.clarifications)
    assert report.schema_version == SCHEMA_VERSION == "1.2.0"
    assert report.provenance.extraction == "llm: m, prompt v0"
    marks = {r.requirement_id: r.extracted for r in report.requirements}
    assert sorted(marks.values()) == [False, True, True]
    assert [c.topic for c in report.clarifications] == ["Which account?"]
    schema = json.loads((ROOT / SCHEMA_FILE).read_text(encoding="utf-8"))
    jsonschema.validate(json.loads(validated_json(report)), schema)  # the committed schema


def test_a_report_without_extraction_has_the_new_keys_all_the_same(
    tmp_path: Path, fixture_catalogue: Catalogue
) -> None:
    loaded = load_documents(_bundle(tmp_path / "b", {"prd.md": CF}))
    report = _report(loaded.spec, fixture_catalogue, None)
    data = json.loads(validated_json(report))
    assert data["provenance"]["extraction"] is None  # B8: every key on every path
    assert data["clarifications"] == []
    assert [r["extracted"] for r in data["requirements"]] == [False]
    assert data["inputs"][0]["extraction"] is None


# --- the Markdown -------------------------------------------------------------------------------


def _markdown(spec, report, catalogue: Catalogue) -> str:  # type: ignore[no-untyped-def]
    return render(report, spec, catalogue, RunInfo("spec", "2026-11-02", "0.1.0"))


def test_the_markdown_tags_extracted_requirements_and_shows_the_extraction(
    tmp_path: Path, fixture_catalogue: Catalogue
) -> None:
    _, result, spec = _merged(tmp_path, {"prd.md": CF, "notes.md": PROSE})
    report = _report(spec, fixture_catalogue, "llm: m, prompt v0", result.clarifications)
    text = _markdown(spec, report, fixture_catalogue)
    assert "| Extraction | llm: m, prompt v0: requirements marked *(extracted)*" in text
    table = text.split("## Functional requirements")[1].split("\n## ")[0]
    assert table.count("*(extracted)*") == 2  # the two extracted rows, not T2's
    assert "## To ask the author" in text
    assert "**Which account?** (notes.md; nothing in the text says): No provider is named." in text
    assert "| Document | Status | Requirements | Reason | Extraction |" in text
    assert "kept 2, dropped 0, merged 0" in text
    assert "Extraction incomplete" not in text


def test_the_markdown_of_an_ordinary_run_is_unchanged(
    tmp_path: Path, fixture_catalogue: Catalogue
) -> None:
    loaded = load_documents(_bundle(tmp_path / "b", {"prd.md": CF}))
    text = _markdown(loaded.spec, _report(loaded.spec, fixture_catalogue, None), fixture_catalogue)
    for absent in ("Extraction", "(extracted)", "To ask the author"):
        assert absent not in text


@pytest.mark.parametrize("reply", [{"items": []}])
def test_an_incomplete_document_puts_a_banner_at_the_top_and_in_the_json(
    tmp_path: Path, fixture_catalogue: Catalogue, reply: object
) -> None:
    text = "- Alpha MUST hold.\n\n- Beta MUST hold.\n\n- Gamma MUST hold.\n"
    loaded = load_documents(_bundle(tmp_path / "b", {"prd.md": CF, "notes.md": text}))
    result = Extractor(Scripted(reply), tmp_path / "c", model="m", max_calls=5).extract(
        loaded.handed
    )
    spec = merge(loaded, result)
    report = _report(spec, fixture_catalogue, "llm: m, prompt v0")
    notes = next(d for d in report.inputs if d.path == "notes.md")
    assert notes.extraction is not None
    assert notes.extraction.incomplete
    md = _markdown(spec, report, fixture_catalogue)
    first_lines = md.split("\n\n")[:3]
    assert any(p.startswith("> **Extraction incomplete**") for p in first_lines)
    assert "notes.md" in md.split("## Summary")[0]


def test_text_from_the_model_in_a_clarification_is_escaped(
    tmp_path: Path, fixture_catalogue: Catalogue
) -> None:
    loaded = LoadedSpec(
        spec=load_documents(_bundle(tmp_path / "b", {"prd.md": CF})).spec, handed=()
    )
    asked = (
        Clarification(
            topic="<img src=x> | topic", reason="a [link](http://x)", quote=None, path="x.md"
        ),
    )
    report = _report(loaded.spec, fixture_catalogue, "llm: m, prompt v0", asked)
    md = _markdown(loaded.spec, report, fixture_catalogue)
    assert "<img" not in md
    assert "[link](http" not in md
