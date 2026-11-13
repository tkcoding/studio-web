# domain-model-mfe — the Project domain model kit

Project › Project domain model (what a project's documents say; not the Studio
domain model), carried over from the prototype's `spec-model-tab.tsx`
(ADR-0069). A built-in kit (`project-domain-model`, ADR-0068 §7) and, until a
platform administrator removes it, a base kit (ADR-0069 §4).

- `src/model/` — the prototype's pure modules, unchanged, with their tests:
  the project domain model and its views (`spec-model`, `domain-layers`,
  `domain-model-views`), reviews and saved edits (`review-state`,
  `saved-entities`), the build's estimate (`build-eta`), needs, hypotheses,
  rules and behaviour (`need-view`, `hypothesis-check`, `rule-checks`,
  `behaviour`), requirement types, the glossary (`glossary-view`,
  `doc-quality`), priorities (`prioritise`, `priority-store`), and who keeps an entity (`entity-gears` with
  `product-configurator`, `product`, `infra-gdl`, as product-mfe moved them).
- `src/api/` — `DomainModelApiService` (studio-documents, studio-spec-mapping,
  studio-product's catalogue, studio-kits) and `dmApi`, the prototype's calls
  without the bearer.
- `src/screens/domain/DomainModelScreen.tsx` — the tab: header, build on my
  key, the seven tabs; each part in its own directory (`entities`,
  `requirements`, `discovery`, `priorities`, `glossary`, `sources`) with its
  own dictionary.

The pure modules stay here: the shell's Studio domain model screens (Admin ›
Domain model, Views and the
generic `type:` tabs) need the domain runtime (`domain-runtime`, the domain
query, the generated model), not this project domain model — see
docs/parity.md. The module names (`spec-model`, `domain-*`) are the
prototype's and stay.
