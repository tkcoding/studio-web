"""T8: the extraction's JSON schema, generated from the model and committed (like the report's).

`extraction.json` is what T7's scorer and T9 read; the review sheet (Markdown) is made from it.
"""

import json
from pathlib import Path

from gears_matcher.extract.models import Extraction

SCHEMA_FILE = Path("schemas/extraction.schema.json")  # relative to the repository root


def extraction_schema_json() -> str:
    """The schema as committed: sorted keys, two-space indent, one trailing newline."""
    return json.dumps(Extraction.model_json_schema(), indent=2, sort_keys=True) + "\n"


def validated_json(extraction: Extraction) -> str:
    """The extraction as JSON, after a round trip through the model (the schema's source)."""
    text = extraction.model_dump_json(indent=2)
    Extraction.model_validate_json(text)
    return text + "\n"
