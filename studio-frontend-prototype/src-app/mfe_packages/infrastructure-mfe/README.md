# infrastructure-mfe — the Infrastructure kit

Organization › Infrastructure (ADR-0056 §2), carried over from the prototype's
`OrgInfrastructure` (`src/environments-screen.tsx` at `00828880`, ADR-0069 §5).
The built-in kit `org-infrastructure` (ADR-0068 §7) and, until a platform
administrator removes it, a base kit (ADR-0069 §4).

Its second entry, `./researchLifecycle` (`src/researchLifecycle.tsx`,
`src/screens/research/`, `src/model/research.ts`), is Organization › Constructor Research,
the screen of the `constructor-research` kit: an opt-in built-in kit, shown
only where the organization installed it (`docs/design/studio-kits.md`
§3.13). It reuses this package's environment form, deploy line and status
parts, and reads `studio-kits`' `GET /installed-kits` so that Infrastructure's
"Add a place › Constructor Research" sends an organization without the kit to
its Kits.

- `src/model/` — the prototype's pure models, unchanged, with their test
  suites: `environments.ts` (form rules, places, readiness, deploy states),
  `releases.ts` (the ladder, what runs where) with what it imports
  (`builds.ts`, `project-deploys.ts`), `namespace-assignments.ts`,
  `images.ts` (retention, sizes, refusals), `registry-browser.ts`,
  `infra-services.ts` (an environment's infra placement), `kubeconfig.ts`;
  `frontend-constructor.ts` holds only the `gearKey` the infra-services
  suite needs.
- `src/api/InfrastructureApiService.ts` — `studio-environments` (environments,
  open clusters, deploys and decisions, status, logs, readiness, Research
  projects and hardware, namespace assignments, image retention, registries),
  `studio-connector` (the places: list, connect, test) and
  `account-management` users (names in deploy lines).
- `src/assets/bootstrap.yaml` — a copy of the repository's
  `deploy/k8s/studio-environments/bootstrap.yaml`, shown by "Connect a
  cluster" (imported with `?raw`). The portal's image builds from
  `studio-frontend-prototype/` alone, so the file lives here;
  `bootstrap.test.ts` fails when the copy drifts from the repository's.
- `src/screens/infrastructure/` — the screen: header, the ladder, what runs
  where, the administrator's Namespaces and Image retention tabs, the places
  grid and a place's side panel (environment form, registry browser, what
  runs there with its status and logs).
