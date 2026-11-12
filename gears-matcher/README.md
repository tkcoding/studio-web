# studio-gears-matcher

The gears-matcher service for studio-web: run the **verified** matcher on a specification by API
and get back a coverage report (what each requirement needs, which Gears cover it, with a confidence).
T9 / HYP-3172; the API contract is [`schemas/service/matcher-service.openapi.yaml`](schemas/service/matcher-service.openapi.yaml).

It is Python, unlike `studio-backend` beside it, and ships as its own image.

## Layout

- `src/gears_matcher/` — the matching code, copied from
  [constructorfabric/gears-matcher](https://github.com/constructorfabric/gears-matcher). `SOURCE`
  names the commit and what was left out (the command line, the evaluation). From the copy on, this
  is the production line of the service.
- `src/gears_matcher/service/` — the HTTP service: request checks, the run store, the run manager and
  the FastAPI routes; `gears-service` starts it.
- `src/gears_matcher/run.py` — the library entry point the service calls: a spec in, a coverage
  report out, with progress, a call budget and cancel. No command line, no printing, no files.
- `schemas/` — the coverage report's schema, the extraction schema, and the service contract
  (`schemas/service/matcher-service.openapi.yaml`).
- `tests/` — the copied core's tests, and `test_run.py` for the library entry point, on a fake model.

Decision: [ADR-0071](../docs/adr/0071-the-gears-matcher-runs-as-a-python-service-beside-the-backend.md);
design: [studio-gears-matcher](../docs/design/studio-gears-matcher.md).

## Run the service

```bash
cd gears-matcher
export GEARS_MATCHER_SECRET=...                 # callers send it as a bearer token
export GEARS_RUST_REPO=/path/to/gears-rust      # the catalogue, read at the pinned commits
export GEARS_MATCHER_DATA=./data                # the run store (SQLite), reply cache, scratch space
export LLM_CONNECTORS_ACCESS_KEY=...            # and the connector's other settings (see below)
uv run gears-service                            # http://0.0.0.0:8080
```

The service refuses to start, and says which variable, if the secret, the checkout or a model client
cannot be set up. `GEARS_MATCHER_ENV_FILE` may name a file holding the connector settings, for a
local run. The others, all optional: `GEARS_MATCHER_HOST`, `GEARS_MATCHER_PORT`, `GEARS_MATCHER_WORKERS`
(default 4), `GEARS_MATCHER_MAX_CONCURRENT_RUNS` (unset: no cap), `GEARS_MATCHER_MAX_CALLS` (the per-run
call bound: a request may lower it, never raise it, and it is the default when a request sets none;
200) and `GEARS_MATCHER_MAX_EXTRACT_CALLS` (100), `GEARS_MD_REF`, `GEARS_GDL_REF`, `GEARS_BUNDLE` (a
gears bundle for `options.use_gears_bundle`).

The connector's settings are `LLM_CONNECTORS_ACCESS_KEY`, `CONSTRUCTOR_STAND`, `CONSTRUCTOR_CMODEL_ID`
and `CONSTRUCTOR_PUBLIC_CONNECTOR_ID`; the matcher uses three models through it (see
`gears_matcher.run.VERIFIED_MODELS`), so the key must cover them all.

Then, as studio-web's backend would (documents carry their own SHA-256):

```bash
curl -s -X POST localhost:8080/v1/runs -H "Authorization: Bearer $GEARS_MATCHER_SECRET" \
  -H "Idempotency-Key: my-run-1" -H "Content-Type: application/json" -d @request.json   # 202, a run
curl -s localhost:8080/v1/runs/<id> -H "Authorization: Bearer $GEARS_MATCHER_SECRET"    # poll
curl -s localhost:8080/v1/runs/<id>/report -H "Authorization: Bearer $GEARS_MATCHER_SECRET"
```

`/healthz` and `/readyz` need no secret. Everything else is in the contract.

## The image

```bash
docker build -t gears-matcher gears-matcher
docker run --rm -p 8080:8080 \
  -e GEARS_MATCHER_SECRET=... \
  -e GEARS_MATCHER_ENV_FILE=/run/llm.env -v ./llm.env:/run/llm.env:ro \
  -v /path/to/gears-rust:/var/lib/gears-matcher/gears-rust:ro \
  -v ./cache:/var/lib/gears-matcher/cache \
  gears-matcher
```

The image needs a `gears-rust` checkout and a writable reply cache; `/readyz` says 503 until the cache can
be written. In a cluster the chart (`deploy/helm/studio-web/templates/matcher/`) clones the checkout onto a
claim and wires the Secrets; see `deploy/README.md`. A mounted checkout owned by another user needs
`-e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*'` (git refuses it
otherwise), which a checkout cloned by the Pod itself does not.

## Work on it

```bash
cd gears-matcher
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run mypy
```

Needs `uv` 0.12.23 or newer and Python 3.12.
