# reports-mfe — the Reports kit

Organization › Reports, carried over from the prototype (ADR-0069). The
built-in kit `org-reports` (ADR-0068 §7) and, until a platform administrator
removes it, a base kit (ADR-0069 §4).

- `src/model/reports-model.ts`, `src/model/roadmap-report.ts`,
  `src/model/plan-model.ts` — the prototype's pure models, unchanged, with
  their test suites.
- `src/api/ReportsApiService.ts` — `studio-reports` (reports, sources,
  schedules, refresh, the roadmap summary, the plan), one `studio-tasks` run
  read (a report's runs live in its organization, hence `?tenant=`), and the
  organization's members from `studio-user` (names in the plan's People).
- `src/api/download.ts` — the two file downloads (the `.xlsx` workbook and
  `gears.yaml`): the REST protocol reads every answer as text, so these go
  through `fetch` with the host's session.
- `src/screens/reports/` — the screen: a card per report, its Configure
  dialog with the plan editor, and the roadmap report's tables.
