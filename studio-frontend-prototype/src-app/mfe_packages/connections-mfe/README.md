# Connections MFE

The source hosts and model providers an organization holds credentials for, and
the form that adds one.

**Feature**: [`docs/feature/connection-create.md`](../../../../docs/feature/connection-create.md)
**Design**: Figma `Constructor Studio mockups`, node `40001018:15055`

> **Organization › Connections is no longer mounted from here.** The tab at
> `/connections` is `admin-mfe`'s `connections` section: the prototype's
> `ConnectorsView` (00828880), the same screen as Admin › Integrations, as the
> prototype rendered both. `mfe.json` declares only the overlay now; the
> `./lifecycle` entry and the list below stay, unmounted, until they are
> removed (`docs/parity.md`, Organization › Connections).

## Two roots, not one

This MFE exposes two entries, and they do not share anything a bundler can see.
`MfeHandlerMF` loads each expose into its own blob-URL module graph, so there are
two apps, two stores and two event buses. What crosses is what the framework
hands over through `globalThis`: the QueryClient and the host session.

| Entry | Extension domain | Renders |
|---|---|---|
| `./lifecycle` | screen | `ConnectionsRoot` → the list at `/connections` |
| `./overlayLifecycle` | overlay | `ConnectSourceDialog`, the create form |

The form is an **overlay extension the shell mounts**, not a dialog this MFE
draws. `connectActions.ts` asks the shell to mount and unmount it through the
extension lifecycle actions; the shell owns the scrim, Escape and click-outside,
and applies them without a veto. That is also why the create is performed in an
effect rather than in the component — a write must not be cancelled by a React
root going away. The kit's `Dialog` is deliberately unused: it does not forward
`keepMounted` to its Portal, so an MFE slot inside it cannot survive a close.

Because the two roots cannot hear each other's events, a created connection
reaches the list by **invalidating the listing on the shared QueryClient**. The
keys line up because both roots build the same descriptor from the same
organization id.

## One gear

Everything here talks to `studio-connector` at `/cf/studio-connector/v1`, and to
nothing else. Four calls: `GET /providers`, `GET /connections?tenant=`,
`POST /connections`, `POST /connections/{id}/test?tenant=`.

Two of those POSTs read rather than write — the gear verifies a credential by
using it. That is why `POST /connections` needs no separate "test connection"
button beside it: it probes the provider before storing anything and answers with
the identity the provider reported, so a rejected token never becomes a
connection.

`POST /connections/{id}/test` is the status column. It is issued **once per row,
independently**, wrapped in its own cached query — never gathered, because
gathering would make the slowest provider the speed of the screen and one
unreachable provider the availability of the screen. It is declared as a mutation
descriptor because the descriptor layer has no POST-shaped read.

Every connection is created at `scope: 'organization'`, owned by the organization
the shell publishes. Neither is a form field: at organization scope a connection
is inherited by every workspace under it, which is what makes it usable from the
New project wizard, and this screen does not know which workspace a member means.

## Four columns have no data source

The mockup has six. These four render a placeholder carrying the reason, and the
FEATURE records each as a `@cpt-gap`:

- **Available data** — nothing on the wire says which resources a connection exposes.
- **Projects** — the only link is `sources[].connection_id` inside each project's
  tenant metadata, and account-management has no bulk read: no `GET /tenants`, no
  subtree endpoint, one metadata GET per project. Counting would cost a walk of
  the whole organization tree plus a request per project on every open, and would
  still miss projects seeded outside the wizard. It needs a rollup on the gear.
- **Last sync** — no connection carries a sync timestamp. `created_at_epoch_secs`
  is deliberately **not** shown here: when the record was written is not when it
  last synchronised, and "8 min ago" would be read as the second thing.
- **Actions** — Manage and Reconnect are `PATCH` and `DELETE`, and both need an
  edit surface this feature does not define.

## Traps worth knowing before you edit

- **`@tanstack/react-query` resolves twice.** The host has 5.101.4, every MFE pins
  5.90.21. At runtime this does not matter — the package is in `sharedDeps`, so
  the bare specifier survives the build and the handler rewrites it to the host's
  copy. In **tests** it does: a bare `useQuery` gets a different
  `QueryClientContext` than the framework's provider mounts, and fails with "No
  QueryClient set". `lifecycle.test.tsx` mocks `useQuery` for exactly this reason.
  This MFE is the first to import `@tanstack/react-query` directly rather than
  through `useApiQuery`, which it has to because the health check is a POST.
- **A popover needs `container`.** The trigger lives in a shadow root; without the
  root element passed as `container`, Base UI portals to `document.body` — outside
  the shadow root, unstyled. And the container must be **state-backed**: a plain
  `useRef` read during render is still `null`, because refs populate at commit.
- **Restate `--font-sans` on every mounted root.** The kit's own token says
  `Inter`, which matches no registered `@font-face`; without the restatement the
  screen silently falls back to system-ui.
- **No Tailwind inside the shadow root.** The re-anchored kit tokens are hex, so a
  colour utility resolves to `hsl(<hex>)` and drops.
- **`mfe.json` is validated against the real `exposes`.** Declaring an entry whose
  `exposedModule` has no matching expose in `vite.config.ts` fails the build.
- **Editing `mfe.json` alone changes nothing.** `generate:mfe-manifests` reads
  `dist`, so the package must be rebuilt first.

## Commands

```bash
npm run dev          # build + preview on :3040
npm run build
npm run type-check
npm run test:unit
```

The screen needs the shell running with the preview servers up — `npm run dev:all`
from `studio-frontend/`. Menu clicks do nothing without them.
