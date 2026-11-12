---
type: adr
status: proposed
date: 2026-11-10
---

# ADR-0071: The gears-matcher runs as a Python service beside the backend, built and deployed with it

**ID**: `cpt-studio-adr-gears-matcher-service`

Status: **proposed** · Date: 2026-11-10 · Relates to the design [studio-gears-matcher](../design/studio-gears-matcher.md)

## Table of Contents

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
- [Consequences](#consequences)
- [Resolved in review: where the runs live](#resolved-in-review-where-the-runs-live)
- [Confirmation](#confirmation)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

## Context and Problem Statement

`studio-spec-mapping` proposes the gears that cover a specification by matching words. The gears-matcher
(constructorfabric/gears-matcher, T9 / HYP-3172) does it with models: it reads a specification, asks
several models which Gears cover each requirement, checks the answers, and writes a coverage report
with a confidence per Gear. It is written in Python, and it is validated there.

Studio wants to run it on request, show its result beside the keyword result, and fall back to the
keyword result when it is not available. A run is unlike the backend's other work:

- it takes minutes (one or more model calls per requirement) and **costs money**, so a retried request
  must never start a second run, and a cancel must say that calls already sent may still be billed;
- it can end `partial` (some requirements were not assessed), which is an outcome and not a failure;
- it needs the Gear catalogue (a private repository at pinned commits) and keys for the LLM connector.

## Considered Options

1. **Port the matcher to a Rust gear in `studio-backend`.** One language and one process, but it is a
   rewrite of about 8,500 lines, and the validated results would have to be reproduced.
2. **A Rust gear that runs the Python command line for each request.** No rewrite, but the backend
   would carry Python, the catalogue and a long paid process, and cancel and progress would be
   exit codes and a log.
3. **A Python service with its own image, called over HTTP by the backend, built and deployed with
   it (chosen).**
4. **A separate service in a separate repository and deployment.** Cleanest ownership, but it does not
   ship with studio-web, and the version the backend calls could drift from the one deployed.

## Decision Outcome

Option 3.

1. **Where it lives.** `gears-matcher/`, a top-level folder beside `studio-backend/`, holds the service: its
   own `pyproject.toml`, Dockerfile, tests and README. It is not under `studio-backend/`: it is not part of the
   Rust workspace, and the backend's CI filter is `studio-backend/**`, so a change to the matcher must not
   rebuild or retest the Rust backend, and the other way round. It is built and tested by a workflow of its
   own. The image is published as `ghcr.io/constructorfabric/studio-web/gears-matcher` and deployed by the
   same chart.
2. **The code.** The matching code is a copy of gears-matcher's core (`SOURCE` names the commit and what
   was left out: the command line and the evaluation, which stay in gears-matcher). The copy is
   restructured as a library: `gears_matcher.run` takes a specification and returns a report, with hooks
   for cancel, progress and usage, and no command line, printing or output files. From the copy on, this
   is the production line of the service.
3. **The order of a run.** Read the format (T2); read free-form documents with a model (T8) only if the
   caller allowed it and T2 handed documents over; then run the `verified` matcher (T11). No model
   that matches starts before the specification is ready.
4. **The API** is the contract in `schemas/service/matcher-service.openapi.yaml`: submit with an
   `Idempotency-Key` and poll, a report, cancel, and `info`. It is its own contract with the backend,
   not one of the portal's (ADR-0020 does not apply to it). It is asynchronous; the backend's task
   polls it.
5. **Run storage: the cluster's PostgreSQL** (decided in review, 2026-11-12). Runs, their idempotency keys
   and their reports are kept in a database of the service's own, `gears_matcher`, on the Studio PostgreSQL
   cluster, as the backend's runtime role, following `studio-backend/AGENTS.md` ("PostgreSQL only"; no
   SQLite and no SQLite-backed tests). The runtime role cannot create databases, so the database is
   made by hand once, owned by it (an init container can do it as the bootstrap role instead); the
   service creates its one table at start. Its pool (3) is counted in the connection budget. It is still
   one replica: a run executes in the Pod that accepted it, and the model-reply cache is on a
   ReadWriteOnce claim.
   **The catalogue is the backend's checkout** (decided in review, 2026-11-12): the matcher mounts the
   backend's Gearbox claim read-only and reads the corpus there at the commit the backend has checked
   out, so it matches against the catalogue Studio shows and clones nothing. That commit moves with the
   backend's corpus branch, not with a pin; each report names the commits it was read at. The claim is
   ReadWriteOnce, so the two Pods share a node. Cloning `gears-rust` at the pinned commits remains a
   chart option.
6. **LLM access and keys.** A dedicated key owned by the studio team, used through the LLM connector, not
   through `studio-llm-proxy`. **The keys are in the service's config file** (`config.toml`, decided in
   review, 2026-11-12): the shared secret between the two services, the connector's settings and the
   catalogue clone token (only when it clones), in one pre-created Secret mounted read-only. For now
   there is one key, and it is the operator's Secret. The database connection is not in
   it: it comes from the operator-managed Secret the backend uses, so a password rotation needs no edit.
   The service never writes document text to an error, and keeps the text of a document only until its
   run ends.
7. **No retention policy and no cost cap in the first build.** Reports are kept as long as the volume
   allows. A run is on request, from an administrator, so exposure is limited by who can start one.

## Consequences

- A Python project sits beside the Rust backend and is not part of its Cargo workspace, so CI gets a Python
  job (lint, types, tests).
- There are two copies of the matching code. The copy can drift from gears-matcher; `SOURCE` and a
  named-commit rule for carrying changes are the only guard.
- One replica means one failure domain, and a restart re-queues unfinished runs (their replies are
  cached, so it is cheap). A second replica needs runs claimed in the database instead of held by the Pod,
  and a reply cache that is not on a ReadWriteOnce claim.
- Python CI needs a PostgreSQL service for the run store's tests.
- Without a cap, a mistaken or repeated request costs money. Revisit before the pilot widens.
- The compare view, the keyword fallback and the pilot tracking are studio-web work and are not decided
  here.

## Resolved in review: where the runs live

The first draft kept runs in SQLite on a volume and asked reviewers to choose. The answer was the
cluster's PostgreSQL. The options that were weighed:

| Option | For | Against |
|---|---|---|
| SQLite on a persistent volume | nothing new to run; fast to build | `studio-backend/AGENTS.md` says "PostgreSQL only"; one replica only; a volume to back up |
| **The cluster's PostgreSQL** (chosen) | the repository's rule; survives a restart; one place to back up | a database to provision, a connection-budget entry, the table in a Python service |
| Postgres through the backend | one owner of data | the service needs the backend to be up to answer a retry; a second API between the two |

## Confirmation

- The contract tests in `gears-matcher/tests` run against the service and its mock;
  the same tests must pass on the real service.
- The image builds in the delivery workflow and the chart deploys it to `dev`.

## More Information

- Phases (stacked pull requests): 1. the structure, the copied core and the library entry point;
  2. the service (HTTP, run store, background runs, health) with the contract tests; 3. the real run
  (format check, free-form reading, `verified`, the connector key and the catalogue); 4. the image, the
  chart and the delivery workflow; 5. the backend's client, which is the studio-web team's.
- The design note that led here is in the gears-matcher repository (`docs/design/t9-studio-web-integration.md`,
  PR #100); the contract's draft is PR #99.

## Traceability

- Design: `cpt-studio-design-gears-matcher`
- Related component: `cpt-studio-component-spec-mapping`
