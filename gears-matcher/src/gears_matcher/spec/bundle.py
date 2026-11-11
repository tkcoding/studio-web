"""`load_spec`: a product spec bundle (or one Markdown file) -> `Spec` (T2 design note §1, §4, §6).

A bundle is a folder with a `manifest.json` (Roman's layout, bundle v2): one entry per product with
its `id`, `name`, `repository`, `specifications_commit` and `files` — each file's `path` (relative
to the manifest), `sha256` and `formal_spec` flag. `product.gdl` is the answer and is never read.

Every manifest file gets an `inputs` row: **read** if it defines CF requirements (D1: any document);
otherwise **skipped** if it is supporting material or describes the build (design, decomposition,
ADR — D3), else **handed to T8**. A bundle with no CF requirement at all is `NotATemplate` (D8).
"""

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath

from pydantic import BaseModel, ValidationError

from gears_matcher.models import Requirement
from gears_matcher.spec.markdown import parse_markdown
from gears_matcher.spec.models import (
    Document,
    InputDoc,
    InputStatus,
    Issue,
    LoadedSpec,
    Spec,
    SpecReport,
)

MANIFEST = "manifest.json"
MAX_BYTES = 5 * 1024 * 1024  # largest spec file or manifest read; real PRDs are under 0.2 MiB
SUPPORTING = "supporting document (not a formal spec)"
_BUILD_DOC_NAMES = {"design.md", "decomposition.md"}
_BUILD_DOC_TYPE = re.compile(r"\A---\s*\n(?:.*\n)*?type:\s*(?:design|decomposition)\s*\n", re.I)
_TITLE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)


class SpecError(Exception):
    """The input cannot be read as a bundle: no manifest, a malformed one, an unknown product."""


class NotATemplate(SpecError):  # noqa: N818 -- the design note's name (D8)
    """No document defines a CF requirement: a free-form spec, for T8."""

    def __init__(self, paths: list[str]) -> None:
        self.paths = tuple(paths)
        super().__init__(
            f"no CF requirement IDs in {len(paths)} document(s) — not a CF template spec;"
            " a free-form spec is read by T8"
        )


class ManifestFile(BaseModel):
    path: str
    sha256: str | None = None
    formal_spec: bool = True


class ManifestProduct(BaseModel):
    id: str
    name: str
    repository: str | None = None
    specifications_commit: str | None = None
    files: list[ManifestFile]


class Manifest(BaseModel):
    products: list[ManifestProduct]


@dataclass(frozen=True)
class _Doc:
    """One document as read: what it gave, and the row it adds to `inputs`."""

    requirements: tuple[Requirement, ...]
    issues: tuple[Issue, ...]
    status: InputStatus
    reason: str


def load_spec(path: Path, product: str | None = None) -> Spec:
    """Read a bundle folder (or a product folder inside one), or a single Markdown file."""
    if path.is_file():
        return _load_file(path)
    root, entry = _locate(path, product)
    return _load_bundle(root, entry)


def load_documents(path: Path, product: str | None = None) -> LoadedSpec:
    """The spec as `load_spec` reads it, and the documents it hands to T8, text included (T8 §4.1).

    Never raises `NotATemplate`: a spec with no CF requirement is a spec with none, and what to do
    about it (extract, or stop) is the caller's. A single file without CF IDs is handed over
    whatever its name: it was named on purpose. A document that fails a check (its SHA-256 differs
    from the manifest) is not handed over: it is `skipped`, with the reason.
    """
    if path.is_file():
        shown, doc, text = _read_single(path)
        if doc.status == "skipped":
            raise SpecError(f"{shown}: {doc.reason}")
        if not doc.requirements:
            doc = _Doc((), doc.issues, "handed-to-t8", "no CF requirement IDs")
        title = _TITLE.search(text)
        return _loaded(
            product_id=path.resolve().parent.name,
            name=title.group(1) if title else path.resolve().parent.name,
            repository=None,
            commit=None,
            docs=[(shown, doc, text)],
        )
    root, entry = _locate(path, product)
    return _loaded(
        product_id=entry.id,
        name=entry.name,
        repository=entry.repository,
        commit=entry.specifications_commit,
        docs=_read_bundle(root, entry),
    )


def _locate(path: Path, product: str | None) -> tuple[Path, ManifestProduct]:
    """The bundle folder and the product in it, for a bundle or a product folder inside one."""
    if (path / MANIFEST).is_file():
        return path, _pick(_read_manifest(path / MANIFEST), product)
    if (path.parent / MANIFEST).is_file():
        return path.parent, _pick(_read_manifest(path.parent / MANIFEST), path.name)
    raise SpecError(f"{path}: not a Markdown file, and no {MANIFEST} in it or its parent")


def _read_manifest(path: Path) -> Manifest:
    try:
        if path.stat().st_size > MAX_BYTES:
            raise SpecError(f"{path}: larger than {MAX_BYTES} bytes — not read")
        return Manifest.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
        raise SpecError(f"{path}: not a usable manifest: {exc}") from exc


def _pick(manifest: Manifest, product: str | None) -> ManifestProduct:
    ids = [p.id for p in manifest.products]
    if product is None and len(ids) == 1:
        return manifest.products[0]
    for entry in manifest.products:
        if entry.id == product:
            return entry
    wanted = "choose one with --product" if product is None else f"no product {product!r}"
    raise SpecError(f"{wanted}; the manifest has: {', '.join(ids) or 'none'}")


def _read_single(path: Path) -> tuple[str, _Doc, str]:
    shown = path.as_posix()
    doc, text = _read(path, shown, expected_sha=None)
    return shown, doc, text


def _load_file(path: Path) -> Spec:
    shown, doc, text = _read_single(path)
    if doc.status == "skipped":
        raise SpecError(f"{shown}: {doc.reason}")
    if not doc.requirements:
        raise NotATemplate([shown])
    title = _TITLE.search(text)
    return _spec(
        product_id=path.resolve().parent.name,
        name=title.group(1) if title else path.resolve().parent.name,
        repository=None,
        commit=None,
        docs=[(shown, doc)],
    )


def _read_bundle(root: Path, entry: ManifestProduct) -> list[tuple[str, _Doc, str]]:
    """Every manifest file, in the manifest's order, with its row and the text it was read from."""
    docs: list[tuple[str, _Doc, str]] = []
    for item in entry.files:
        doc, text = _document(root, item)
        docs.append((item.path, doc, text))
    return docs


def _load_bundle(root: Path, entry: ManifestProduct) -> Spec:
    docs = _read_bundle(root, entry)
    if not any(doc.requirements for _, doc, _ in docs):
        raise NotATemplate([p for p, _, _ in docs])
    return _spec(
        product_id=entry.id,
        name=entry.name,
        repository=entry.repository,
        commit=entry.specifications_commit,
        docs=[(p, doc) for p, doc, _ in docs],
    )


def _loaded(
    *,
    product_id: str,
    name: str,
    repository: str | None,
    commit: str | None,
    docs: list[tuple[str, _Doc, str]],
) -> LoadedSpec:
    """The spec and its hand-over. A handed document whose SHA-256 differs from the manifest is not
    handed: the bundle is not what it claims, so T8 never reads it (T8 note §4.1). No other error
    does that: a CF ID inside a never-read section, say, is reported, but it is about text that
    `blank_hidden` blanks anyway, so it costs the document nothing."""
    checked: list[tuple[str, _Doc, str]] = []
    for path, doc, text in docs:
        mismatch = next((i for i in doc.issues if i.kind == "hash_mismatch"), None)
        if doc.status == "handed-to-t8" and mismatch is not None:
            doc = _Doc((), doc.issues, "skipped", f"not handed to T8: {mismatch.message}")  # noqa: PLW2901
        checked.append((path, doc, text))
    spec = _spec(
        product_id=product_id,
        name=name,
        repository=repository,
        commit=commit,
        docs=[(p, doc) for p, doc, _ in checked],
    )
    handed = tuple(
        Document(path=p, text=text)
        for p, doc, text in sorted(checked, key=lambda d: d[0])
        if doc.status == "handed-to-t8"
    )
    return LoadedSpec(spec=spec, handed=handed)


def _document(root: Path, item: ManifestFile) -> tuple[_Doc, str]:
    """One manifest file: its row, and the text it was read from ("" when it was not read)."""
    relative = PurePosixPath(item.path)
    file = root / relative
    if not file.resolve().is_relative_to(root.resolve()):
        return _failed(item.path, "unsafe_path", "path leaves the bundle folder — not read"), ""
    if not file.is_file():
        return _failed(item.path, "missing_file", "listed in the manifest but not on disk"), ""
    doc, text = _read(file, item.path, item.sha256)
    if item.sha256 is None:  # TK's review of #27: an unverified file is a fact to show
        unverified = Issue(
            severity="info",
            kind="no_sha256",
            message="no SHA-256 in the manifest — content not verified",
            where=item.path,
        )
        doc = replace(doc, issues=(*doc.issues, unverified))
    if doc.requirements or doc.status == "skipped":
        return doc, text
    if not item.formal_spec:
        return _Doc((), doc.issues, "skipped", SUPPORTING), text
    if _describes_build(relative, text):
        return _Doc((), doc.issues, "skipped", "describes the build, not the product (D3)"), text
    return _Doc((), doc.issues, "handed-to-t8", "formal spec without CF requirement IDs"), text


def _read(file: Path, shown: str, expected_sha: str | None) -> tuple[_Doc, str]:
    """Parse one file; a hash mismatch or an undecodable file is an error, never a silent pass."""
    try:
        if file.stat().st_size > MAX_BYTES:
            reason = f"larger than {MAX_BYTES} bytes — not read"
            return _Doc((), (_error("too_large", reason, shown),), "skipped", reason), ""
        data = file.read_bytes()
    except OSError as exc:
        reason = f"cannot be read ({exc.strerror or exc})"
        return _Doc((), (_error("unreadable", reason, shown),), "skipped", reason), ""
    issues: list[Issue] = []
    if expected_sha is not None and hashlib.sha256(data).hexdigest() != expected_sha.lower():
        issues.append(_error("hash_mismatch", "SHA-256 differs from the manifest", shown))
    try:
        text = data.decode("utf-8").removeprefix("\ufeff")
    except UnicodeDecodeError as exc:
        issues.append(_error("not_utf8", f"not UTF-8 ({exc.reason} at byte {exc.start})", shown))
        return _Doc((), tuple(issues), "skipped", "not UTF-8 — not read"), ""
    parsed = parse_markdown(text, shown)
    count = len(parsed.requirements)
    reason = f"defines {count} CF requirement{'s' * (count != 1)}"
    return _Doc(parsed.requirements, (*issues, *parsed.issues), "read", reason), text


def _failed(path: str, kind: str, message: str) -> _Doc:
    return _Doc((), (_error(kind, message, path),), "skipped", message)


def _error(kind: str, message: str, where: str) -> Issue:
    return Issue(severity="error", kind=kind, message=message, where=where)


def _describes_build(path: PurePosixPath, text: str) -> bool:
    """A design, decomposition or ADR document: how the product is built (D3)."""
    if path.name.lower() in _BUILD_DOC_NAMES:
        return True
    if any(part.lower() == "adr" for part in path.parts[:-1]):
        return True
    return _BUILD_DOC_TYPE.match(text) is not None


def _spec(
    *,
    product_id: str,
    name: str,
    repository: str | None,
    commit: str | None,
    docs: list[tuple[str, _Doc]],
) -> Spec:
    requirements = [r for _, doc in sorted(docs, key=lambda d: d[0]) for r in doc.requirements]
    requirements, duplicates = _unique_ids(requirements)
    issues = [i for _, doc in docs for i in doc.issues] + duplicates
    inputs = tuple(
        InputDoc(path=p, status=d.status, requirements=len(d.requirements), reason=d.reason)
        for p, d in docs
    )
    status = Counter(i.status for i in inputs)
    kind = Counter(r.kind for r in requirements)
    report = SpecReport(
        requirements=len(requirements),
        fr=kind["fr"],
        nfr=kind["nfr"],
        no_must_level=sum(r.must_level is None for r in requirements),
        planned=sum(r.planned for r in requirements),
        read=status["read"],
        handed_to_t8=status["handed-to-t8"],
        skipped=status["skipped"],
        issues=tuple(issues),
    )
    return Spec(
        product_id=product_id,
        name=name,
        repository=repository,
        commit=commit,
        requirements=tuple(requirements),
        inputs=inputs,
        report=report,
    )


def _unique_ids(requirements: list[Requirement]) -> tuple[list[Requirement], list[Issue]]:
    """A repeated ID is an error (D5): both kept, the later ones suffixed `--2`, `--3`, ..."""
    seen: Counter[str] = Counter()
    unique: list[Requirement] = []
    issues: list[Issue] = []
    for req in requirements:
        seen[req.id] += 1
        if seen[req.id] > 1:
            where = f"{req.source.path}:{req.source.line}"
            issues.append(_error("duplicate_id", f"{req.id} is defined again — kept as --N", where))
            req = req.model_copy(update={"id": f"{req.id}--{seen[req.id]}"})  # noqa: PLW2901
        unique.append(req)
    return unique, issues
