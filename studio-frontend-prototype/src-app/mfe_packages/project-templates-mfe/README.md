# project-templates-mfe — Workspace › Project templates

What a new project may start from: its sources, a brief, the kits ticked and
the tabs its projects show. Carried over from the prototype (ADR-0069 §5) into
the built-in kit `project-lifecycle` (ADR-0068 §7).

- `src/model/project-types.ts` — the prototype's model, unchanged, with its
  test suite. `src/model/project-tabs.ts` carries what it imported from the
  rest of the prototype, and the prototype's list of project tabs as data
  (see its header).
- `src/api/ProjectTemplatesApiService.ts` — `studio-organizations` project
  types per tenant (read, replace, drop), and the `studio-kits` catalogue.
- `src/screens/project-templates/ProjectTemplatesScreen.tsx` — the editor.
