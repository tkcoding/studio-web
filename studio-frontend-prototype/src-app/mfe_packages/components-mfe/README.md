# components-mfe — the Components kit

The prototype's Components area carried over (ADR-0069), as the built-in kit
`components` (ADR-0068 §7). One entry, four extensions, switched by the
extension the shell mounted (`scopeOf`):

| Extension | Level | Route | Screen |
|---|---|---|---|
| `…components.screens.platform.v1` | platform | `/platform/components` | the platform's catalogue (ADR-0042) |
| `…components.screens.repositories.v1` | platform | `/platform/repositories` | what the platform's catalogue reads |
| `…components.screens.publications.v1` | platform | `/platform/publication-requests` | publication requests and gear curators |
| `…components.screens.organization.v1` | organization | `/components` | the registry beside the catalogue (ADR-0041) |

- `src/model/` — the prototype's pure modules, unchanged, with their tests
  (`registry`, `org-gear-repository`, `component-tiers`, `component-kinds`,
  `readiness`, `field-trend`, `responsibility`, `review-summary`); plus
  `catalogue.ts` and `sources.ts`, the rules the prototype kept inside
  `components-catalog.tsx` and `component-registry.tsx`, taken out with tests.
- `src/api/ComponentsApiService.ts` — the `studio-components-catalog` routes,
  each naming the organization on screen (`organization_id`), and what the
  kit borrows from `studio-connector`, `studio-kits`, `studio-user` and
  `studio-tasks`.
- `src/screens/components/` — the screens.

What is not carried over yet is listed in `docs/parity.md`.
