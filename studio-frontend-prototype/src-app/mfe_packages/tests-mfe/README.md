# tests-mfe — the Tests kit

Project › Tests, carried over from the prototype (ADR-0069). A built-in kit
(ADR-0068 §7) and, until a platform administrator removes it, a base kit
(ADR-0069 §4).

- `src/model/tests.ts` — the prototype's `tests-model.ts`, unchanged, with the
  build helpers it needs; `tests.test.ts` is its test suite.
- `src/api/TestsApiService.ts` — the reads: CI runs, repositories, open pull
  requests (`studio-artifact-ingest`), document checks (`studio-documents`),
  spec ↔ code (`studio-spec-mapping`).
- `src/screens/tests/TestsScreen.tsx` — the screen.

The joins the screen does are a backend candidate: one route that answers
"is this project green?" for a person and an agent alike.
