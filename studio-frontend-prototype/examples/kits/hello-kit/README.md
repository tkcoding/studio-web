# hello-kit

A kit from outside the portal's build (ADR-0068 phase 5): one project tab,
**Hello**, whose screen the portal loads at run time from the kit's own
bundle, and two contributions into screens the kit does not own — a panel on
Project › Overview (slot `screen.panels`) and a chip beside the open project
in the path bar (slot `project.header.status`). Installing the kit shows them,
uninstalling takes them out (and a page showing the tab says it is not
available here), installing a new version swaps them in without a reload, and
the portal is not rebuilt for any of it.

It is deliberately not under `src-app/mfe_packages/`: nothing in the portal's
`npm run build` sees it. It builds with the portal's `node_modules` (it sits
inside `studio-frontend-prototype/`, so Node finds them one level up), and the
shell provides the shared dependencies (React, `@gears-frontx/*`, react-query,
redux) at run time; `@constructor-studio/mfe-shared` and the ui-kit travel
inside the bundle, as in every portal MFE.

## What is in it

| File | What |
|---|---|
| `kit.gdl` | The kit's passport: `name` (its slug), `version`, `levels`, and `mfe = [path("mfe/hello")]`, the bundle |
| `mfe.json` | The FrontX manifest: three Module Federation entries; one screen extension (level `project`, route `/hello-kit`, kit `hello-kit`) and two slot contributions (type `…shell.slots.contribution.v1~`: the panel with `screen: "/projects/overview"`, the status chip) |
| `vite.config.ts` | The same Module Federation build as a portal MFE, written into `mfe/hello/`; exposes `./lifecycle`, `./panel`, `./status` |
| `src/` | The screen, the panel and the chip |

The slots a kit can contribute into, and what a contribution's
`presentation` says, are the shell's contract: `src-app/app/mfe/slots.ts` and
`docs/design/studio-kits.md` §3.12.

`mfe/hello/` (git-ignored) is the built bundle: `mfe-manifest.json`,
`remoteEntry.js`, `assets/`, `shared/`. That directory is what the backend
serves.

## Build it

```bash
cd studio-frontend-prototype
npm ci                      # once
npm run build:package       # once: the frontxMfGts build plugin
cd examples/kits/hello-kit
npx vite build              # writes mfe/hello/
```

## Serve it

The backend reads kits from a directory: every subdirectory with a `kit.gdl`
that names bundles is a kit in the library (shelf `organization`, source
`bundle-dir`), at the version its passport states.

```bash
STUDIO_KIT_BUNDLES_DIR=/path/to/studio-frontend-prototype/examples/kits
# several backend replicas: one key for all, at least 16 characters
STUDIO_KIT_BUNDLE_KEY=…
```

In a container, mount the directory and point the variable at the mount, for
example `-v $PWD/studio-frontend-prototype/examples/kits:/kits:ro` and
`STUDIO_KIT_BUNDLES_DIR=/kits`. The backend logs
`studio-kits: serving kit bundles from a directory` with the number of kits.

## Try it

1. `GET /cf/studio-kits/v1/catalog?shelf=organization` lists `hello-kit`.
2. Install it for a project (or on a project's Kits tab):
   `PUT /cf/studio-kits/v1/project-kits/hello-kit?project_id=<project>` with `{}`.
3. `GET /cf/studio-kits/v1/mfe-manifests?project_id=<project>` lists the
   package `hello` with its `base_path`.
4. Open the project in the portal: a **Hello** tab is there. The portal was
   not rebuilt.
5. `DELETE /cf/studio-kits/v1/project-kits/hello-kit?project_id=<project>`:
   the tab is gone.

A bundle that was not built is listed with `config: null` and an `error`; the
portal shows a tile saying the kit's screens could not be loaded, and the rest
of the portal works.
