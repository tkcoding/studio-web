# issues-mfe — the Issues kit

Project › Issues, carried over from the prototype (ADR-0069): everything to
decide about a project in one table — what stops a build, what to look at,
how the documentation could be better, what was decided. A built-in kit
(`project-issues`, ADR-0068 §7) and, until a platform administrator removes
it, a base kit (ADR-0069 §4).

- The queue, its groups (`blocks`, `look`, `decided`), each row's passages and
  the actions it offers are the server's (`GET /studio-documents/v1/project-domain-model/issues`),
  and so is the verdict (`GET /project-domain-model/readiness`), every fact's review
  key (`fact_key` on `GET /project-domain-model`) and the documentation's thin
  places with the change each proposes (`GET /project-domain-model/doc-quality`:
  the entity folding, layers, drafts and similar glossary pairs moved to
  studio-documents' `spec_model/doc_quality.rs` with their tests). The
  prototype computed all four in the browser; none of that is carried here.
- `src/model/issue-rows.ts` — the table's rows over the server's two lists,
  the issue text, and `relationSentence`, which redraws a proposed sentence as
  a person edits its verb.
- `src/model/saved-entities.ts` — entities saved on this screen: their rows
  stay hidden until a build that finished after the save reads the document
  (`pruneSaved`, `withSaved`); moved unchanged with its tests.
- `src/model/spec-model.ts`, `src/model/build-eta.ts` — the build line, its
  progress and estimate, and the passages' labels; moved unchanged.
- `src/api/IssuesApiService.ts` — the reads and writes (studio-documents;
  the organization's members and their GitHub logins from studio-user).
- `src/screens/issues/` — the screen.
