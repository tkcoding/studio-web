"""The checks on a submitted run (contract: `POST /v1/runs`), all before any paid call.

A request that fails costs nothing and is never stored, so the caller can fix it and send it again
with the same `Idempotency-Key`.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from gears_matcher.service.errors import bad_request, too_large, unprocessable

# The contract's patterns (the OpenAPI file is the source of truth; its tests keep them equal).
KEY = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
GEAR = re.compile(r"^[a-z0-9][a-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
PATH = re.compile(r"^(?!/)(?!.*(^|/)\.\.(/|$))[^\x00-\x1f\x7f\\]+\.md$")
PATH_MAX = 300
_FIELDS = {"product", "own_gears", "documents", "options"}
_DOC_FIELDS = {"path", "sha256", "content"}
_OPTION_FIELDS = {"use_gears_bundle", "max_calls", "extract_max_calls"}


@dataclass(frozen=True)
class Limits:
    """What the service accepts. Published by `GET /v1/info`; the values are set at deployment."""

    max_documents: int = 20
    max_document_bytes: int = 500_000
    max_request_bytes: int = 2_000_000
    max_calls: int = 400  # measured: Studio's PRD 126 calls, Insight's 192
    max_extract_calls: int = 100
    max_concurrent_runs: int | None = None  # None: no cap (T9 D16, for now)
    max_run_seconds: int = 3600

    def as_json(self) -> dict[str, int]:
        full = {
            "max_documents": self.max_documents,
            "max_document_bytes": self.max_document_bytes,
            "max_request_bytes": self.max_request_bytes,
            "max_calls": self.max_calls,
            "max_extract_calls": self.max_extract_calls,
            "max_concurrent_runs": self.max_concurrent_runs,
            "max_run_seconds": self.max_run_seconds,
        }
        return {k: v for k, v in full.items() if v is not None}


@dataclass(frozen=True)
class Document:
    path: str
    sha256: str
    content: str


@dataclass(frozen=True)
class RunRequest:
    product: str
    documents: tuple[Document, ...]
    own_gears: tuple[str, ...] = ()
    use_gears_bundle: bool = False
    max_calls: int = 400
    extract_max_calls: int | None = None

    def to_json(self) -> dict[str, Any]:
        """What is stored while the run is not finished (so a restart can run it again)."""
        return {
            "product": self.product,
            "own_gears": list(self.own_gears),
            "documents": [
                {"path": d.path, "sha256": d.sha256, "content": d.content} for d in self.documents
            ],
            "options": {
                "use_gears_bundle": self.use_gears_bundle,
                "max_calls": self.max_calls,
                "extract_max_calls": self.extract_max_calls,
            },
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RunRequest":
        options = data["options"]
        return cls(
            product=data["product"],
            documents=tuple(Document(**d) for d in data["documents"]),
            own_gears=tuple(data["own_gears"]),
            use_gears_bundle=options["use_gears_bundle"],
            max_calls=options["max_calls"],
            extract_max_calls=options["extract_max_calls"],
        )


def body_digest(body: Any) -> str:
    """The same body gives the same digest whatever the key order; used by idempotency."""
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def parse_request(body: Any, limits: Limits) -> RunRequest:
    """Check a decoded body against the contract; raise `ProblemError` for the first failure."""
    if not isinstance(body, dict) or set(body) - _FIELDS:
        raise bad_request("the body must be an object with known fields only")
    product = body.get("product")
    docs = body.get("documents")
    if not isinstance(product, str) or not product or not isinstance(docs, list) or not docs:
        raise bad_request("product and at least one document are required")
    if len(docs) > limits.max_documents:
        raise too_large(f"at most {limits.max_documents} documents")
    documents = tuple(_document(d, limits) for d in docs)
    paths = [d.path for d in documents]
    if len(set(paths)) != len(paths):
        raise bad_request("two documents have the same path")
    options = body.get("options") or {}
    if not isinstance(options, dict) or set(options) - _OPTION_FIELDS:
        raise bad_request("options: known fields only")
    return RunRequest(
        product=product,
        documents=documents,
        own_gears=_own_gears(body.get("own_gears", [])),
        use_gears_bundle=_bundle_flag(options.get("use_gears_bundle", False)),
        max_calls=_bound(options.get("max_calls"), "max_calls", limits.max_calls, limits.max_calls),
        extract_max_calls=_optional_bound(
            options.get("extract_max_calls"), "extract_max_calls", limits.max_extract_calls
        ),
    )


def _document(doc: Any, limits: Limits) -> Document:
    if not isinstance(doc, dict) or set(doc) != _DOC_FIELDS:
        raise bad_request("a document needs path, sha256 and content, and nothing else")
    path, digest, content = doc["path"], doc["sha256"], doc["content"]
    if not isinstance(path, str) or len(path) > PATH_MAX or not PATH.search(path):
        raise unprocessable("bad_path", f"not an allowed path: {str(path)[:80]!r}")
    if not isinstance(digest, str) or not SHA256.match(digest) or not isinstance(content, str):
        raise bad_request(f"{path}: sha256 must be 64 lower-case hex digits and content a string")
    data = content.encode()
    if len(data) > limits.max_document_bytes:
        raise too_large(f"{path}: over the document size limit")
    if hashlib.sha256(data).hexdigest() != digest:
        raise unprocessable("hash_mismatch", f"{path}: sha256 does not match content")
    if not content.strip():
        raise unprocessable("unreadable_spec", f"{path}: the document has no text")
    return Document(path, digest, content)


def _own_gears(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise bad_request("own_gears must be a list")
    bad = [g for g in value if not isinstance(g, str) or not GEAR.match(g)]
    if bad:
        raise unprocessable("unknown_own_gear", f"not Gear ids: {bad[:3]}")
    return tuple(dict.fromkeys(value))


def _bundle_flag(value: Any) -> bool:
    if not isinstance(value, bool):
        raise bad_request("options.use_gears_bundle must be true or false")
    return value


def _bound(value: Any, name: str, cap: int, default: int) -> int:
    if value is None:
        return default
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise bad_request(f"options.{name} must be a positive integer")
    if value > cap:
        raise unprocessable("over_cap", f"options.{name} is over the cap of {cap}")
    return value


def _optional_bound(value: Any, name: str, cap: int) -> int | None:
    return None if value is None else _bound(value, name, cap, cap)


def check_key(key: str | None) -> str:
    """The `Idempotency-Key` header, or a 400."""
    if key is None or not KEY.match(key):
        raise bad_request("Idempotency-Key is required (1-128 of A-Za-z0-9._:-)")
    return key
