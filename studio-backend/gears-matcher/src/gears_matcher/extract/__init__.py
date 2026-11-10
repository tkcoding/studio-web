"""T8: free-form requirement extraction (design note `docs/design/t8-free-form-extraction.md`)."""

from gears_matcher.extract.extractor import (
    EXTRACT_BUDGET_S,
    BoundHit,
    ExtractError,
    Extractor,
    ExtractPlan,
    empty_extraction,
)
from gears_matcher.extract.merge import merge
from gears_matcher.extract.models import (
    EXTRACT_SCHEMA_VERSION,
    Clarification,
    DocumentOutcome,
    Dropped,
    Extracted,
    Extraction,
    ExtractionReport,
    ExtractItem,
    ExtractReply,
    Span,
    UnclearItem,
)
from gears_matcher.extract.prompt import EXTRACT_PROMPT_VERSION
from gears_matcher.extract.schema import SCHEMA_FILE, extraction_schema_json, validated_json

__all__ = [
    "EXTRACT_BUDGET_S",
    "EXTRACT_PROMPT_VERSION",
    "EXTRACT_SCHEMA_VERSION",
    "SCHEMA_FILE",
    "BoundHit",
    "Clarification",
    "DocumentOutcome",
    "Dropped",
    "ExtractError",
    "ExtractItem",
    "ExtractPlan",
    "ExtractReply",
    "Extracted",
    "Extraction",
    "ExtractionReport",
    "Extractor",
    "Span",
    "UnclearItem",
    "empty_extraction",
    "extraction_schema_json",
    "merge",
    "validated_json",
]
