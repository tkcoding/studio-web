---
type: design
status: proposed
owner: studio-team
---

# Technical Design — studio-gears-matcher

- [ ] `p1` - **ID**: `cpt-studio-design-gears-matcher`

The design of the gears-matcher service. The decision to build it this way is
[ADR-0071](../adr/0071-the-gears-matcher-runs-as-a-python-service-beside-the-backend.md). The code is
[`gears-matcher/`](../../gears-matcher/), and its contract is
[`matcher-service.openapi.yaml`](../../gears-matcher/schemas/service/matcher-service.openapi.yaml).
It sits beside `studio-spec-mapping` ([design](studio-spec-mapping.md)), which matches by words and stays
the baseline and the fallback. This is a Python service with its own image, not a Rust gear: it is built
and deployed with studio-web but is not part of the Cargo workspace.

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Principles & Constraints](#2-principles--constraints)
- [3. Technical Architecture](#3-technical-architecture)
- [4. Additional context](#4-additional-context)
- [5. Traceability](#5-traceability)

## 1. Architecture Overview

### 1.1 Architectural Vision

A Python service that runs the gears-matcher's verified matcher on a specification and returns a coverage
report: which Gears cover each requirement, with a confidence. A caller submits a run, polls it, and reads
the report. A run is slow and costs money, so the service is asynchronous, never starts a second run for a
retried request, and reads the specification in a fixed order: the format first, free-form reading by a
model only when needed, and the matching models only when everything before them is ready.

### 1.2 Run states

| Run state | Meaning |
|---|---|
| `queued`, `running`, `cancelling` | in progress; `progress` and `usage` say how far and what it has cost |
| `succeeded` | every requirement was assessed |
| `partial` | a report exists, but some requirements were **not assessed** (a call failed, or the call budget ran out); an outcome, not a failure |
| `failed` | no report; `error.kind` is `input` (fix the request) or `internal` |
| `cancelled` | stopped by the caller; calls already sent may still be billed |

## 2. Principles & Constraints

### 2.1 Design Principles

#### Nothing is paid for before the input is ready

- [ ] `p1` - **ID**: `cpt-studio-principle-gears-matcher-ready-first`

1. **Format (T2).** The documents are read as Constructor Fabric spec files. In the format: step 3.
2. **Free-form reading (T8), only if needed.** Documents that are not in the format are read by a model
   when the request set `options.extract_max_calls`; otherwise the request is refused with
   `422 not_a_template` before anything is paid for.
3. **Matching (`verified`, T11).** Two models read the whole catalogue, checks decide the build list, a
   report check judges every candidate. One call budget (`options.max_calls`) covers all models.

`gears_matcher.run.run_matching` is this order as a library call, with hooks for cancel, progress and
usage. The service calls it in-process on a worker thread.

#### A retried request never starts a second run

- [ ] `p1` - **ID**: `cpt-studio-principle-gears-matcher-idempotent`

The same `Idempotency-Key` and body returns the existing run with the same `202`. The same key with
another body is `409 idempotency_conflict`. A refused request stores nothing, so the caller can fix it and
resend with the same key.

### 2.2 Constraints

#### One replica, and the run store is a decision still open

- [ ] `p2` - **ID**: `cpt-studio-constraint-gears-matcher-store`

Runs, keys and reports are kept in SQLite on a persistent volume in the cluster, behind a store interface,
for one replica (ADR-0071 section 5). This departs from the backend's PostgreSQL rule, and where the data
should live is an open question in the ADR.

## 3. Technical Architecture

### 3.1 Inside the service

- **Request checks** (before any paid call): the body's shape, the documents' paths and hashes, sizes,
  the caps.
- **Run store**: the run, its key, its progress and usage and its report; the request's document text only
  until the run ends. After a restart, unfinished runs are queued again.
- **Cancel.** A flag the run checks before each model call and each requirement. Calls already sent are
  counted and may be billed.
- **Size.** A request over a limit is refused whole with `413`; the body is read and discarded first so the
  caller sees the answer, not a dropped connection.

### 3.2 Deployment

An image `gears-matcher` (a Python image with `git`, a numeric non-root user and a healthcheck), built by its own
workflow, `.github/workflows/gears-matcher.yml`, because Studio Delivery's component detection and snapshot
copying are Rust- and portal-shaped (`gearbox-engine.yml` and `studio-cli.yml` are the precedent for an
artifact with its own workflow). Every pull request that touches the component runs its gates and builds the
image; a push to `main` of the upstream repository publishes `gears-matcher:sha-<commit>` and `edge`.

Chart templates in `deploy/helm/studio-web/templates/matcher/`, off unless `matcher.enabled`: a Deployment of
one replica (Recreate, because the claim is ReadWriteOnce) whose init container clones `gears-rust` onto the
claim, a Service, a kept PersistentVolumeClaim for the run store, the reply cache and the checkout, and a
NetworkPolicy that lets only the backend call it. The Pod reads pre-created Secrets: the LLM connector's
settings, the catalogue clone token (optional) and the shared secret between the backend and this service.
`/healthz` is the liveness and startup probe; `/readyz` is the readiness probe and says 503 when the run store
or the reply cache cannot be used, so a wrong mount is found at deploy time.

## 4. Additional context

The service runs: `gears-service` serves the contract on top of the library entry point, with SQLite for
runs, and has been called over HTTP with the real catalogue and the real models. The image builds and runs,
and the chart renders and validates. Not built yet: the backend's client, the compare view and the pilot
tracking; and nothing is deployed to a cluster, so the chart has not run on one. Each is a later pull
request (ADR-0071, phases).

## 5. Traceability

- **ADRs**: [ADR-0071](../adr/0071-the-gears-matcher-runs-as-a-python-service-beside-the-backend.md)
- **Related design**: [studio-spec-mapping](studio-spec-mapping.md)
