# document-types-mfe — Workspace › Document types

Templates, section checklists and rules for the documents of every project in
a workspace. Carried over from the prototype (ADR-0069 §5) into the built-in
kit `project-specs` (ADR-0068 §7).

- `src/model/doc-types.ts` — the editor's form as pure functions, lifted out
  of the prototype's `TypesView` (documents.tsx), with tests.
- `src/api/DocumentTypesApiService.ts` — `studio-documents` workspace types
  (list, save as the workspace's own) and the `studio-spec-quality`
  analyser's accepted type keys.
- `src/screens/document-types/DocumentTypesScreen.tsx` — the list and the
  editor.
