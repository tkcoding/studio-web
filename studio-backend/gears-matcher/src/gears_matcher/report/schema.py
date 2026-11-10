"""D13: the report's JSON schema, generated from the model and committed."""

import json
from pathlib import Path

from gears_matcher.report.models import CoverageReport

SCHEMA_FILE = Path("schemas/coverage-report.schema.json")  # relative to the repository root


def report_schema_json() -> str:
    """The schema as committed: sorted keys, two-space indent, one trailing newline."""
    return json.dumps(CoverageReport.model_json_schema(), indent=2, sort_keys=True) + "\n"


def validated_json(report: CoverageReport) -> str:
    """The report as JSON, after a round trip through the model (the schema's source)."""
    text = report.model_dump_json(indent=2)
    CoverageReport.model_validate_json(text)
    return text + "\n"
