# studio-gears-matcher

The gears-matcher service for studio-web: run the **verified** matcher on a specification by API
and get back a coverage report (what each requirement needs, which Gears cover it, with a confidence).
T9 / HYP-3172; the API contract is [`schemas/service/matcher-service.openapi.yaml`](schemas/service/matcher-service.openapi.yaml).

It is Python, unlike the rest of `studio-backend`, and ships as its own image beside the backend.

## Layout

- `src/gears_matcher/` — the matching code, copied from
  [constructorfabric/gears-matcher](https://github.com/constructorfabric/gears-matcher). `SOURCE`
  names the commit and what was left out (the command line, the evaluation). From the copy on, this
  is the production line of the service.
- `src/gears_matcher/run.py` — the library entry point the service calls: a spec in, a coverage
  report out, with progress, a call budget and cancel. No command line, no printing, no files.
- `schemas/` — the coverage report's schema, the extraction schema, and the service contract
  (`schemas/service/matcher-service.openapi.yaml`).
- `tests/` — the copied core's tests, and `test_run.py` for the library entry point, on a fake model.

Decision: [ADR-0069](../../docs/adr/0069-the-gears-matcher-runs-as-a-python-service-beside-the-backend.md);
design: [studio-gears-matcher](../../docs/design/studio-gears-matcher.md).

## Work on it

```bash
cd studio-backend/gears-matcher
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run mypy
```

Needs `uv` 0.12.23 or newer and Python 3.12.
