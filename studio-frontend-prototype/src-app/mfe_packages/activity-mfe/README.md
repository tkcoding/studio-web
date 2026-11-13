# activity-mfe — the Activity kit

Project › Activity and Project › Timeline, carried over from the prototype
(ADR-0069). The `project-activity` kit: a built-in kit (ADR-0068 §7) and,
until a platform administrator removes it, a base kit (ADR-0069 §4).

- `src/model/activity.ts` — the prototype's `activity-filter.ts` (runs of one
  check folded into one row) and the choices `activity-view.tsx` made inline.
- `src/model/timeline.ts`, `src/model/fields.ts` — the rules of the
  prototype's `project-timeline.tsx` and the pure parts of its domain runtime.
- `src/api/ActivityApiService.ts` — the activity feed
  (`studio-artifact-ingest`) and the Studio domain model's `types`, `query`
  and `mutate` (`studio-domain-model`).
- `src/screens/activity`, `src/screens/timeline` — the two sections, in one
  entry (`ActivityRoot` switches on the section).

Activity needs nothing but this kit. The Timeline shows `milestone`, which is
project-lifecycle's type (ADR-0070 §7): its extension declares
`"needs": ["milestone"]` and the shell hides the tab where the organization's
model does not have the type installed. Opened from an old address anyway, it
says so instead of failing.
