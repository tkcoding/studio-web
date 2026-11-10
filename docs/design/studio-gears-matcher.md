---
type: design
status: proposed
owner: studio-team
---

# Technical Design — studio-gears-matcher

- [ ] `p1` - **ID**: `cpt-studio-design-gears-matcher`

A Python service that runs the gears-matcher's `verified` matcher on a specification and returns a
coverage report. The decision to build it this way is
[ADR-0069](../adr/0069-the-gears-matcher-runs-as-a-python-service-beside-the-backend.md). The code is
[`studio-backend/gears-matcher/`](../../studio-backend/gears-matcher/), and its contract is
[`matcher-service.openapi.yaml`](../../studio-backend/gears-matcher/schemas/service/matcher-service.openapi.yaml).
It sits beside `studio-spec-mapping` ([design](studio-spec-mapping.md)), which matches by words and stays
the baseline and the fallback.

## 1. What it does

A caller submits a run with the specification's documents (path, SHA-256 and text each) and an
`Idempotency-Key`, then polls it, then reads the report. The report is gears-matcher's own coverage
report, unchanged, with its own `schema_version`.

| Run state | Meaning |
|---|---|
| `queued`, `running`, `cancelling` | in progress; `progress` and `usage` say how far and what it has cost |
| `succeeded` | every requirement was assessed |
| `partial` | a report exists, but some requirements were **not assessed** (a call failed, or the call budget ran out); an outcome, not a failure |
| `failed` | no report; `error.kind` is `input` (fix the request) or `internal` |
| `cancelled` | stopped by the caller; calls already sent may still be billed |

## 2. The order of a run

1. **Format (T2).** The documents are read as Constructor Fabric spec files. In the format: step 3.
2. **Free-form reading (T8), only if needed.** Documents that are not in the format are read by a model
   when the request set `options.extract_max_calls`; otherwise the request is refused with
   `422 not_a_template` before anything is paid for.
3. **Matching (`verified`, T11).** Two models read the whole catalogue, checks decide the build list, a
   report check judges every candidate. One call budget (`options.max_calls`) covers all models.

`gears_matcher.run.run_matching` is this order as a library call, with hooks for cancel, progress and
usage. The service calls it in-process on a worker thread.

## 3. Inside the service

- **Request checks** (before any paid call): the body's shape, the documents' paths and hashes, sizes,
  the caps. A refused request stores nothing, so the caller can fix it and resend with the same key.
- **Run store**: SQLite on a persistent volume in the cluster, behind a store interface (ADR-0069 §5;
  where it should live is an open question there). It keeps the run,
  its `Idempotency-Key`, its progress and usage, and its report; the request's document text only until
  the run ends. After a restart, unfinished runs are queued again.
- **Idempotency.** The same key and body returns the existing run with the same `202`. The same key with
  another body is `409 idempotency_conflict`.
- **Cancel.** A flag the run checks before each model call and each requirement. Calls already sent
  are counted and may be billed.
- **Size.** A request over a limit is refused whole with `413`; the body is read and discarded first so the
  caller sees the answer, not a dropped connection.

## 4. Deployment

An image `gears-matcher`, published with the others, and chart templates beside `backend/` and
`frontend/`: a deployment (one replica), a service, a volume for SQLite and the model-reply cache, and
references to pre-created Secrets: the LLM connector key, the catalogue clone token, and the shared secret
between the backend and this service. The backend calls it inside the cluster.

## 5. Not built yet

The service itself (the contract and the library entry exist), the image, the chart and the delivery
workflow, the backend's client, the compare view and the pilot tracking. Each is a later pull request
(ADR-0069, phases).
