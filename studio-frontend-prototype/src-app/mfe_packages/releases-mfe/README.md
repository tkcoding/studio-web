# releases-mfe — the Releases kit

Project › Releases (ADR-0056 §4), carried over from the prototype's
`releases-tab.tsx` (ADR-0069 §5). The built-in kit `product-releases`
(ADR-0068 §7) and, until a platform administrator removes it, a base kit
(ADR-0069 §4).

- `src/model/` — the prototype's pure modules, unchanged, with their tests:
  `releases.ts`, `builds.ts`, `environments.ts`, `project-deploys.ts`,
  `images.ts` (the same copies infrastructure-mfe holds: packages do not share
  src), `pipeline.ts`, `infra-gdl.ts`, and `product-profiles.ts` (the profile
  part of `product.ts`).
- `src/api/ReleasesApiService.ts` — targets, deploys, decisions, previews,
  bindings, secrets, a build's log and images (`studio-environments`); builds,
  CI runs, repositories, Build in CI (`studio-artifact-ingest`); the product
  description's profiles (`studio-product`); the places (`studio-connector`);
  a deploy's run (`studio-tasks`); the project config's build workflow and
  users' names (`account-management`).
- `src/screens/releases/` — the screen: `ReleasesScreen.tsx` (header, the
  Build / Deploy / History steps), `Ladder.tsx`, `DeployActions.tsx`,
  `Builds.tsx`, `Bindings.tsx`, `History.tsx`.

What the prototype had here and this kit does not yet is listed in
`docs/parity.md` (row "Releases").
