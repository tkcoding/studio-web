"""The matcher as a service (T9, HYP-3174): an HTTP API that runs the verified matcher.

The contract is `schemas/service/matcher-service.openapi.yaml`; the design is
`docs/design/studio-gears-matcher.md` (at the repository root). The parts, each small and testable
alone:

- `request`: the checks on a submitted run, before anything is paid for;
- `store`: runs and their idempotency keys in PostgreSQL;
- `runner`: what a run needs from the matcher (a seam: the real one, and fakes in tests);
- `manager`: submit, execute in the background, cancel, recover after a restart;
- `app`: the FastAPI routes; `__main__`: the process that serves them.
"""
