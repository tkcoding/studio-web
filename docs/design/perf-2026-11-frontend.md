---
type: design
status: accepted
owner: studio-team
---

# Portal frontend performance, November 2026: what a page load costs and what was cut

A measured pass over the FrontX portal (`studio-frontend-prototype/`: the shell in
`src-app/app`, the kit MFEs in `src-app/mfe_packages/*`, `mfe-shared`). The work is on
branch `AndrejK666/frontend-perf-2026-11`, on top of `AndrejK666/frontx-portal`
(21d8584c). Every number below was measured. None is an estimate.

## How it was measured

**Bundle sizes.** Two complete builds were compared: the baseline at 21d8584c and the
branch. Each build ran `build:package`, `build:mfes`, `generate:mfe-manifests
--base-path /mfes`, `vite build` and `package:mfe-assets`. A script summed each
MFE's `dist/assets` (its own code), its `dist/shared` (the standalone shared
dependencies) and the host's `dist/assets`. It reports raw and gzip sizes. The
gzip figure is what nginx sends, because `gzip on` covers JS and CSS.

**Requests.** A headless-Chrome harness served each build. It is a scratch tool and was
not committed. It has three parts:

- **Server.** A small Node server serves `dist/` with the cache headers of
  `nginx.conf.template`, including ETag and 304 responses.
- **Fake backend.** `/cf/*` is answered from a fixed world: one organization, one
  workspace, one project, and one repository with a week of activity. Each answer is
  delayed by 60 ms. The token endpoint is fake, so the shell signs in without Keycloak.
- **Driver.** It runs system Chrome through `playwright-core`. Every scenario starts
  in a fresh browser context, so the cache is cold. One scenario also reloads the page
  to measure a warm cache. The driver waits until the network has been quiet for
  2.5 s, then the server log is cut per scenario.

Each scenario ran twice per build, and the request counts matched in both runs.

**Main-thread cost.** CDP `Performance.getMetrics` was read after the page went quiet
and after a forced GC. The figure is the median of 5 cold loads.

**Limits of the harness.**

- It speaks HTTP/1.1 to one local process. Absolute milliseconds therefore mean little:
  6-connection queuing dominates them. Counts, bytes and the depth of the request
  chain are what carry over to a deployment.
- The fake answers are thin. Two screens, Project › Overview and Domain model, throw on
  a field the fake does not fill. They throw the same way in both builds, so the
  comparison still holds.

## What a cold load cost before

Organization root, cold cache, baseline:

| What | Raw | gzip |
|---|---|---|
| Host entry chunk `index-*.js` | 1295 KB | 398 KB |
| Shared dependencies (`mfes/<mfe>/shared/*.js`, 13 files, fetched once and reused across MFEs by `contentHash`) | 1988 KB | 408 KB |
| Every MFE's stylesheet, prefetched at bootstrap (`prewarmShadowStyles`, 21 files) | ~800 KB | — |
| `generated-mfe-manifests.json` | 320 KB | 14 KB |
| **Total sent by the server (harness, uncompressed)** | **5070 KB in 75 requests** | |

A reload of the same page with a warm cache still downloaded **2329 KB in 17
requests**. Neither the shared chunks nor the MFE catalogue are under an `assets/`
path, so nginx gave them `no-store`.

The API chain before the first screen was six steps deep:

1. `GET /me`
2. `/me/memberships` and `/studio-user/v1/me` (the person)
3. `GET /tenants/<org>`
4. The organization's reads: workspaces, installed kits, types, logo, settings
5. `/studio-kits/v1/mfe-manifests`
6. The MFE loads, then its own data

The first second of every page also sent three to four `POST /studio-presence/v1/me`.
Every tab click cost a `GET /me/inbox` as well, and the server reads every Inbox source
to answer it.

## What was changed

| # | Change | Where | Commit |
|---|---|---|---|
| 1 | The standalone shared chunks are minified as the last build step: after the CJS patches that match esbuild's readable output, before `contentHash`. Bare imports keep the form the handler's rewrite regex matches (`from"react"`). Export names are never mangled. | `src/build/mf-gts.ts` (`minifySharedChunkSource`), test `__tests__/build/shared-chunk-minify.test.ts` | 872c08e0 |
| 2 | `dts: false` in every MFE's federation config. The type archive `@mf-types.zip` is read by nothing, and generating it ran `tsc` over the whole MFE on every build. | `src-app/mfe_packages/*/vite.config.ts`, `examples/kits/hello-kit` | c812bba8 |
| 3 | `no-cache` (revalidate against ETag; a 304 while unchanged) instead of `no-store` for `/mfes/*/shared/` and `/generated-mfe-manifests.json`. | `nginx.conf.template` | 7f8b4711, 1b50bec4 |
| 4 | A bare `lodash` import resolves to a module that re-exports only `clamp` and `upperFirst` from per-method files. `@gears-frontx/studio` imported those two from CommonJS lodash, which cannot tree-shake, so the whole library sat in the entry chunk. `lucide-react/dynamic`'s name map, every lucide icon behind an `import()`, is loaded on first use by `ManifestIcon` instead of with the shell. | `vite.config.ts`, `src-app/app/lib/lodash.ts`, `src-app/app/layout/ManifestIcon.tsx` (+ test), `LevelTabs.tsx`, `ProductMenu.tsx` | 552004fa |
| 5 | The memberships and the person are requested alongside `/me`, not after it. | `effects/contextCatalogs.ts`, `effects/bootstrapEffects.ts` (+ tests) | 109e1974 |
| 6 | The presence heartbeat reports a place once it has held for 750 ms (`PLACE_SETTLE_MS`). | `presence/presence.ts` (+ tests) | 17a3cab0 |
| 7 | A move re-reads the Inbox count only when the person leaves the Inbox or an Overview, where items are marked, or when the count is older than 15 s (`INBOX_FRESH_MS`). Review events and the two-minute timer are unchanged. | `layout/useInboxEntry.ts` (+ tests) | ed09cb75 |
| 8 | The Sources sparkline is projects-mfe's only Recharts user. It is now `React.lazy`, and the build's `__frontx_lazy` rewrite keeps it in the MFE realm (ADR-0022). The cell keeps the chart's box and accessible name while the chart loads. | `projects-mfe/.../sources/LazyActivitySparkline.tsx`, `sourceColumns.tsx` (+ tests) | 140813ed |

The module-federation plugin stays at 1.20.1. Commit 552004fa says "about 1100 KB" for
the entry chunk; that figure was taken with only the lodash half of the change. The
figures below are final.

## Results

### Bundles

| | Before | After |
|---|---|---|
| Host entry chunk | 1295 KB / 398 KB gz | **1006 KB / 321 KB gz** (−22 %) |
| …lucide name map, now its own chunk loaded with the first tab icon | (inside the entry) | 228 KB / 53 KB gz |
| Shared dependencies, per page (and per MFE `dist`) | 1988 KB / 408 KB gz | **770 KB / 240 KB gz** (−61 % raw, −41 % gz) |
| projects-mfe lifecycle chunk (every project screen) | 736 KB / 228 KB gz | **399 KB / 130 KB gz** |
| …Recharts + sparkline, only on Project › Sources | (inside lifecycle) | 336 KB / 98 KB gz |
| `build:mfes`, all 24 MFEs, this machine | ≈ 19 min (by file times) | **6.1 min** (367 s) |
| One MFE build (tests-mfe) | 43 s | 18 s |

### Requests per scenario (harness; counts identical over two runs)

| Scenario | Server bytes before → after | API calls before → after | Duplicate API calls before → after |
|---|---|---|---|
| Organization root, cold | 5070 KB → **3790 KB** | 18 → **16** | 2 → **0** |
| Organization root, **reload (warm cache)** | 2329 KB / 17 downloads → **20 KB / 3 downloads + 14 × 304** | 19 → 17 | 2 → 0 |
| Workspace › Projects list, cold | 5802 KB → **4186 KB** | 20 → **18** | 2 → 0 |
| Project › Overview, cold | 5798 KB → **4182 KB** | 31 → **28** | 4 → **1** |
| Inbox, cold | 5060 KB → **3780 KB** | 17 → **15** | 2 → 0 |
| Click Workspaces / People / Overview (org) | 3 / 6 / 3 | 3 / **5** / **2** | |
| Click Activity / Domain model (project) | 2 / 11 | **1** / **10** | |

The API chain before the first screen is now five steps deep instead of six, because
the memberships no longer wait for `/me`. Presence sends one POST per page, not three
or four. The tab glyphs and the Sources sparkline (7 bars, 96×24) were checked to draw
in the real browser on both builds: no page errors, and the sparkline chunk is fetched
only on Sources.

### Main thread (CDP, median of 5 cold loads, after GC)

| Page | Task time | Script time | JS heap |
|---|---|---|---|
| Organization root | 1824 → **1490 ms** | 612 → 536 ms | 17.0 → 16.5 MB |
| Project › Overview | 1959 → **1761 ms** | 662 → 642 ms | 19.3 → 18.1 MB |

## Found and not changed

These are left with a reason each, in order of what they would save.

- **Every MFE's stylesheet at bootstrap: ~800 KB raw, 21 requests, 21 `replaceSync`
  parses.** `prewarmShadowStyles` does this on purpose (`mfe-shared/mfe/shadowStyles.ts`):
  a shadow root must adopt its sheets before its first render, or the screen flashes
  unstyled. Prewarming only the levels in reach, or prewarming from idle time, means
  choosing which first mount may flash. That is a product decision, not a perf fix.
  With the immutable cache on `assets/` it costs nothing after the first visit.
- **The remaining API chain:** `/me` → organization tenant → organization reads →
  `mfe-manifests` → MFE load → MFE data.
  - The organization's reads could start from the `org=` in the address before
    `materialize` confirms it. That moves routing's "the slice is the truth" rule
    (ADR-0028), so it was left alone.
  - `mfe-manifests` waits on the installed-kits answer, because its signature is how a
    kit install is noticed. A short `staleTime` would let it hand back a stale answer
    right after an install.
- **`project.config` metadata is read twice on Project screens.** The shell reads it,
  and then the projects-mfe realm reads it with its own `@gears-frontx/api` instance.
  Each realm has its own fetch cache by design (MFE isolation), so one realm cannot
  answer for the other.
- **The host entry chunk is still 1 MB.** By package before minification: `@base-ui/react`
  400 KB, `src-app` 330 KB, `@gears-frontx/mfes` 256 KB, `ajv` 205 KB,
  `@gears-frontx/studio` 148 KB, `gts-ts` 144 KB, `axios` 107 KB. These are FrontX
  runtime and kit components, which the shell needs before anything mounts.
  `manualChunks` is not an option: @module-federation/vite 1.20 ignores it, and 1.23
  honours it with a TDZ crash.
- **Other heavy MFE chunks:** product-mfe lifecycle 435 KB, domain-model-mfe 304 KB,
  admin-mfe 317 KB. No single library dominates the way Recharts did in projects-mfe.
  Splitting them means lazy screens per section, a change per kit.
- **Shared dependencies deduplicated across MFEs.** They already are, for the network.
  `@gears-frontx/mfes` reuses a shared chunk across MFEs by `name@version@contentHash`,
  and every MFE builds byte-identical chunks, so a page fetches each chunk once. Each
  realm still evaluates its own copy. That is the isolation model, not a bug.
  `@gears-frontx/ui-kit`, `lucide-react` and `mfe-shared` are compiled into each MFE
  for the same reason (`mfe-shared/README.md`).
- **Build time.** Each MFE rebuilds the same 13 shared dependencies with esbuild. One
  cache per `build:mfes` run would save a few seconds per MFE.
- **`useListState`** sets a new state object on every `popstate`, even when the list's
  part of the address is unchanged. Only four lists use it, and no read depends on the
  object's identity, so nothing re-fetches because of it.
- **Two SSE connections at start-up:** `/stream`, then `/stream?organization_id=`. They
  count against HTTP/1.1's six connections in the harness. Behind an HTTP/2 ingress
  they do not.

## How to repeat the measurement

1. Build twice, baseline and branch, with the full `build` chain.
   - On Git Bash, set `MSYS_NO_PATHCONV=1`. Without it `--base-path /mfes` turns into
     `C:/Program Files/Git/mfes` and no MFE loads.
   - Set `TSX_DISABLE_CACHE=1` when other worktrees build at the same time.
2. Serve each `dist/` with cache headers as in `nginx.conf.template`, and answer `/cf/*`
   from a fixed world, slowed by a fixed delay.
3. Provide `/env.js` with an `OIDC_ISSUER` on the same origin whose `/token` returns a
   token, and seed `sessionStorage['studio.oidc.refresh']` before the page loads.
4. Drive system Chrome through `playwright-core` from the prototype's `node_modules`.
   Cut the server log per scenario. Compare counts and bytes, not milliseconds.
