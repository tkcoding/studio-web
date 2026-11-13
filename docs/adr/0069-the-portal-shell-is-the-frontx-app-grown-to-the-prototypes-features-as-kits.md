---
type: adr
status: proposed
date: 2026-11-06
---

# ADR-0069: The portal's shell is the FrontX app, grown to the prototype's features as kits

**ID**: `cpt-studio-adr-frontx-portal-shell`

Status: **proposed** · Date: 2026-11-06 · Builds on ADR-0068 (Studio is a shell, and everything inside it comes from kits), ADR-0006 (rebuild the portal on FrontX), ADR-0050 (FrontX micro-frontends) · Amends ADR-0068 §5 (who installs a kit)

## Table of Contents

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [1. The shell is the FrontX app](#1-the-shell-is-the-frontx-app)
  - [2. A copy, in the prototype's place](#2-a-copy-in-the-prototypes-place)
  - [3. Parity is measured against the prototype](#3-parity-is-measured-against-the-prototype)
  - [4. Who installs a kit](#4-who-installs-a-kit)
  - [5. How the prototype's code moves](#5-how-the-prototypes-code-moves)
- [Phases](#phases)
- [Consequences](#consequences)
- [Confirmation](#confirmation)
- [Open questions](#open-questions)

<!-- /toc -->

## Context and Problem Statement

Studio has two portals on one backend:

- **`studio-frontend`**: the FrontX app that ADR-0006 started. The UI team
  owns it. It has Workspaces, People, Connections, Projects and some project
  sections, Search and the Editor frame. Its screens are FrontX
  micro-frontends. Each one says in `mfe.json` which level it belongs to,
  where it goes and in what order.
- **`studio-frontend-prototype`**: the walking skeleton ADR-0006 "moved aside".
  It kept growing and is where nearly every feature landed: the platform
  level, the organization's Overview, Infrastructure, Costs, Components,
  Reports and Background work, the project's Specs, Domain model, Product,
  Releases and Tests, all of Admin, the Inbox, pins, saved views, the
  assistant, and the domain-model tabs of ADR-0066. It is React without
  FrontX: one `App.tsx` of about 10,000 lines and one hand-written API client.

ADR-0068 decided that Studio is a shell and that everything inside it,
Studio's own features included, comes from kits. It did not say which of the
two apps is that shell. Kits need one: the place a kit's screen is mounted,
the bridge it is handed, and the manifest format its tabs are declared in.

The question: **which app becomes the shell, and how does it get the
prototype's features without a rewrite nobody can review?**

## Considered Options

1. **Grow the prototype into the shell.** It has the features already. An
   experiment (branch `AndrejK666/prototype-shell-kits`) placed kit tabs on
   all four levels and mounted a remote screen through a FrontX-style
   `mount`/`unmount` bridge. But the UI team cannot take over a codebase
   that follows none of FrontX's rules, and the hardest part is still
   undone: splitting `App.tsx` into a shell.
2. **Develop in `studio-frontend` directly.** It is the right codebase, but
   the UI team is changing the same directory at the same time. Every one of
   dozens of moves would collide with their work. The app would also stay
   out of the deployment slot people use until it is complete.
3. **Copy `studio-frontend` into the prototype's place and grow the copy to
   the prototype's features, as kits.**

**Chosen: 3.** The skeleton is the one the UI team works in, so they can
take it over. The copy lives where the prototype is deployed, so it
replaces the prototype without a new image, chart or ingress. It is
assembled on one branch without touching the UI team's directory.

## Decision Outcome

### 1. The shell is the FrontX app

ADR-0068 §1 lists what the shell holds. In this app that is the host
application (`src-app/app`): the levels and their tab bars, the shared
context (selected organization, workspace and project, theme, language, the
person), sign-in, the Inbox, pins, filters, search, the kit library and
the installer.

A kit's screen is a FrontX micro-frontend. ADR-0068 §2 calls the point where a
kit adds a tab `tab` on a level. That point is an extension in `mfe.json`.
Its `presentation` already carries `level`, `placement`, `section` and
`order`. The levels grow from three to the five the prototype has:
platform, organization, workspace, project, and Admin.

A kit says where its screens go in its `kit.gdl` (ADR-0068 §3), through
`frontx_mfe(...)`, and the shell loads them at run time from the kit's
artifact (ADR-0068 §8, §10).

Today the host reads its micro-frontends from a manifest generated at build
time (`generated-mfe-manifests.json`). It changes to read the kits installed
for the organization in view from the backend (`studio-kits`), each with its
`mfe.json`. Built-in kits are the ones compiled into the image.

### 2. A copy, in the prototype's place

- On one branch, `AndrejK666/frontx-portal`, `studio-frontend` is copied over
  `studio-frontend-prototype`. The prototype's own code leaves that directory.
- The image `studio-frontend-prototype`, its chart templates, its ingress and
  its compose service keep their names. The prototype's CI jobs run the
  copy's gates instead: lint, type-check, build and the unit suites.
- `studio-frontend` is not touched on this branch. Changes the UI team
  lands there meanwhile are carried into the copy before the branch is
  merged. The copy base is recorded so that is one diff.

### 3. Parity is measured against the prototype

The prototype at the copy base is the reference. Every screen and shell
feature it has is a row in `studio-frontend-prototype/docs/parity.md`. The
row says which kit (ADR-0068 §7) or which shell mechanism takes it, and
whether it is done.

Dev keeps serving the prototype from its last image tag until every row is
done. The new image is built by CI but not deployed to Dev before then.

### 4. Who installs a kit

ADR-0068 §5 says on which level a kit's parts are installed. This adds who
installs it. Each level installs from its own context, on its own Kits tab:

| Kind | Installed by | Where it applies | From which shelf |
|---|---|---|---|
| **Base kits** | the platform: a platform administrator, in Platform › Kits | every organization: this is what Studio is for everyone | built-in, official |
| **Organization kits** | an organization, for itself: an organization administrator, in Organization › Kits | that organization and its projects | built-in, official, the organization's own |
| **Project kits** | a project, for itself: whoever may administer the project, in Project › Kits | that project only | any kit whose levels include the project |

The base kits are what a new organization starts with. Today's features,
once they are built-in kits (ADR-0068 §7), are base kits. An organization
adds what it needs on top of them, and a project on top of both.

What a kit's screens are placed on is still the kit's. Each tab names its
level (§1). Installing only decides for whom those screens exist: a project
shows a kit's tab when the kit is a base kit, the organization's, or the
project's own.

A level cannot uninstall what a level above installed: an organization not a
base kit, a project neither a base kit nor an organization kit. It can hide
that kit's tabs on its levels, as with any tab (ADR-0066). A kit installed on
more than one level is one installation where they meet, at the newest of the
versions.

### 5. How the prototype's code moves

| Prototype part | Moves as |
|---|---|
| Pure modules (`*.ts` with their `*.test.ts`: models, codecs, rules) | unchanged, into the shared library or the kit that uses them |
| Generated domain types (`domain-model.gen.ts`) | a shared package. `scripts/gen-domain-client.mjs` writes there |
| The API client (`api.ts`) | split by kit. Each kit gets its calls as a FrontX `BaseApiService` |
| Screens (`*.tsx`) | rewritten as kit micro-frontends under FrontX's rules: ui-kit, design tokens, i18n, MFE isolation |
| The shell in `App.tsx` | not moved. The FrontX host is the shell (§1) |
| `/api-docs/` and `/architecture/` | extra pages of the same image, carried over as they are (open question 2) |

## Phases

| Phase | Delivers | Depends on |
|---|---|---|
| 1 | The copy boots in the prototype's place on Studio's backend and sign-in. CI runs its gates. The parity list exists | — |
| 2 | Shell mechanisms: five levels, kits read from the backend, Platform › Kits (base kits), Organization › Kits and Project › Kits, Inbox sources, pins, saved views and filters, tab order, the event channel, domain-model tabs | 1, ADR-0068 phases 1–2 |
| 3 | The prototype's features as built-in kits, one per change, each closing its parity rows, in ADR-0068 §7 order | 2 |
| 4 | The prototype's image leaves Dev. The final directory name is settled (open question 1) | 3 |

## Consequences

- Good, because the UI team inherits a portal built the way they build, not
  a second codebase to learn.
- Good, because every kit's screen is a FrontX micro-frontend from the
  start. A kit written for Studio is also a frontend part of the product
  constructor (ADR-0050).
- Good, because Dev and the people using the prototype are undisturbed until
  parity.
- Bad, because for a while there are two FrontX apps in the repository. The
  UI team's changes to `studio-frontend` have to be carried over (§2).
- Bad, because the screens are rewritten, not moved. That cost is the price
  of the UI team being able to take the result.

## Confirmation

- `studio-frontend-prototype/` on the branch is a FrontX app, and its CI job
  runs lint, type-check, build and every unit suite.
- `studio-frontend-prototype/docs/parity.md` has no open row when the
  prototype's image leaves Dev.
- A kit installed by an organization for itself shows its tabs in that
  organization only, a project kit in that project only. A base kit shows them
  in every organization.

## Open questions

1. **The final directory**: whether `studio-frontend-prototype` is renamed to
   `studio-frontend` and the old one removed, or the names stay. To be
   settled with the UI team before phase 4.
2. **`/api-docs/` and `/architecture/`**: whether they stay extra pages of the
   portal image or become kit screens on the platform level.
