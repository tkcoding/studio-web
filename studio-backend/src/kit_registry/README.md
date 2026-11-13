# studio-kits

The catalogue of kits, and which kits a project wants installed.

The design — why kit bytes stay in Git, what the gear records and what `cfs`
does, scope and reconciliation, the REST surface and where installations are
stored — is [`docs/design/studio-kits.md`](../../../docs/design/studio-kits.md).
This README is what you need to work in the directory.

## In the assembly

- Gear `studio-kits`, capabilities `[rest]`, deps `account_management`.
- `STUDIO_KIT_CATALOGUE`: the catalogue, as a JSON array of kits
  (`slug`, `name`, `repository_url`, `default_version` required;
  `description`, `publisher`, `visibility` = `public`, `source` = `github`,
  `manifest_path` = `.cf-studio-kit.toml` optional). Unset, it is
  `official_catalogue()` in `service.rs`, Constructor's own kits; moving their
  pinned default commits is a change there. A value that does not read stops
  the gear at start rather than offering other kits; `[]` offers none. Each
  entry must be a kit the IDE's installer allow-lists (`sdlc`, `compete`),
  from that kit's own repository: the installer installs by slug.
- Materialize, reconcile and the repository list call the project's session
  through [`../studio_theia`](../studio_theia), so they need a backend built
  with the `theia-bridge` feature and a running session; without either they
  answer 503.
- A project's installations are one tenant-metadata document,
  `cf.studio.project.kit_installations.v1~`, declared in `config/*.yaml`.
- The library has three shelves (`shelf` on each catalogue entry):
  `builtin` (`builtin_catalogue()` in `service.rs`, compiled in, at Studio's
  own version, empty `repository_url`), `official` (the catalogue above) and
  `organization` (each organization's own, `shelf.rs`: see below). `?shelf=` filters
  `GET /catalog`; the IDE asks for `official` only, the kits `cfs` can install.
  The built-in kits are the portal's features, each arriving as a kit:
  `project-lifecycle`, `project-issues`, `project-tests`, `project-artifacts`,
  `project-activity`, `project-specs`, `org-costs`, `org-reports`,
  `studio-api-docs` (level `platform`), `components` (platform, organization
  and project), `org-infrastructure`, `product-releases`,
  `project-domain-model`, `org-connections`, `project-team`, `assistant`
  (Studio AI, the chat panel the shell docks in its sidebar; no route, its
  permissions are studio-llm-proxy's client settings and chat completions) and
  `constructor-research`. Every built-in kit is a base kit by default except
  those in `OPT_IN_BUILTIN` (`service.rs`): `constructor-research` applies only
  where an organization installs it (or a platform administrator makes it a
  base kit). A feature ported into the portal is added here,
  with its contents in `contents.rs`: its screens (a route only once the
  portal has one) and, in `permissions`, the routes its screens call — a
  test holds every one to `docs/api-contract.json`.
- What is inside a kit before anyone installs it (ADR-0068 §4), `contents.rs`:
  `GET /studio-kits/v1/catalog/{kit_slug}` (any signed-in user; 404 for a
  slug the library does not hold) answers `{kit, contents, manifest}`;
  `contents` holds every section of a kit manifest (`screens`, `types`,
  `rules`, `functions`, `services`, `inbox`, `mcp_tools`, `permissions`,
  `material`, `kinds`, `docs`), each present and possibly empty. Where it
  comes from, in `manifest`:
  - `built-in`: declared in `builtin_contents()`, only what Studio has today
    (the tab, its route, the gears' routes its screen calls). Change it when
    the screen changes.
  - `.cf-studio-kit.toml`: an official kit, read from the copy of its
    manifest in `manifests/` at the commit `official_catalogue()` pins
    (material = each resource's `install_path`, kinds = the
    `[kits.resources.artifacts.<KIND>]` keys). Nothing is fetched on request.
    **Moving a pin means replacing that copy** — a test holds the two
    together. A deployment that pins another commit or repository gets empty
    contents and `null`.
  - `null`: nothing reliable describes the kit (organization kits, re-pinned
    kits).
  Also the MCP tool `kits_describe`.
- Who installs a kit (ADR-0069 §4), `installed.rs`: **base kits** for every
  organization, by a platform administrator, kept on the platform root
  (`00000000-…-0001`); **organization kits**, by the organization's
  administrators (owner, a role with `kit.manage`, or a platform
  administrator), kept on the organization; **project kits**, for one project,
  by whoever may install kits for the project's organization (a project has
  no access config of its own), kept on the project, and only a kit whose
  `levels` include `project` (400 `failed_precondition`,
  `NOT_A_PROJECT_KIT`). All are tenant metadata
  `cf.studio.kits.installed.v1~` (`config/*.yaml`, `override_only`, so a
  project never inherits its organization's document), written only by this
  gear as its service identity (`GEAR_HELD_METADATA`). A built-in kit is a
  base kit until a platform administrator removes it (`removed_builtin`). An
  organization cannot uninstall a base kit (400 `failed_precondition`,
  `BASE_KIT`); a project neither a base kit nor an organization kit
  (`BASE_KIT`, `ORGANIZATION_KIT`). A kit on more than one level applies at
  the newest version (dotted numbers compare as numbers, anything else by
  install time): `effective` = (base ∪ organization) ∪ project.

  | Method | Path | Who |
  | --- | --- | --- |
  | `GET` | `/studio-kits/v1/installed-kits?organization_id=` or `?project_id=` | any member: `{organization_id, project_id, base, organization, project, effective}` (`project` empty and `project_id` null without a project) |
  | `PUT` / `DELETE` | `/studio-kits/v1/base-kits/{kit_slug}` | platform administrator (`PLATFORM_ADMIN_REQUIRED`) |
  | `PUT` / `DELETE` | `/studio-kits/v1/organization-kits/{kit_slug}?organization_id=` | organization administrator (`KIT_ADMIN_REQUIRED`) |
  | `PUT` / `DELETE` | `/studio-kits/v1/project-kits/{kit_slug}?project_id=` | the project's organization administrator (`KIT_ADMIN_REQUIRED`) |

  `PUT` takes `{version?}` and answers the installation; `DELETE` answers 204.
  Each is also an MCP tool (`mcp.rs`): `kits_catalog`, `kits_describe`,
  `kits_installed`, `kit_base_install`, `kit_base_uninstall`,
  `kit_organization_install`, `kit_organization_uninstall`,
  `kit_project_install`, `kit_project_uninstall`. The project-scoped
  `/projects/{project_id}/installations` routes (what the IDE materializes)
  are a separate record and unchanged.
- An organization's own kits (ADR-0068 phase 7), `shelf.rs` and
  `manifest.rs`: a source is `{connection_id, repository, path, ref, slug?}`
  through one of the organization's own non-personal connections
  (studio-connector's `Repository`). It is pinned to the newest commit that
  touched `path` on `ref`, its manifest read there (`kit.json`, else
  `.cf-studio-kit.toml`) and checked, and the manifest kept in the
  organization's installed-kits document under `shelf`. Routes
  (`?organization_id=`): `GET /organization-shelf` (members),
  `POST /organization-shelf/preview`, `POST /organization-shelf`,
  `POST /organization-shelf/{kit_slug}/refresh`,
  `DELETE /organization-shelf/{kit_slug}` (kit administrators). Refusals:
  `KIT_SLUG_TAKEN` (a built-in or official slug), `KIT_INSTALLED` (removing an
  installed kit). `GET /catalog?organization_id=` adds the shelf;
  `GET /catalog/{kit_slug}` describes a shelf kit with `origin`. MCP:
  `kits_shelf`, `kit_shelf_preview`, `kit_shelf_add`, `kit_shelf_refresh`,
  `kit_shelf_remove`. `kit.json` is documented in
  `docs/design/studio-kits.md` §3.9.
- A kit's model overlay (ADR-0067 §6), `models.rs`: the overlay is `model` in
  a `kit.json` (a built-in kit's in `builtin/<slug>.kit.json`, compiled in;
  format in `docs/design/studio-kits.md` §3.10 and
  `domain_model/kit_overlay.rs`). It goes into the organization's model
  through the domain model's port (`sync_kit_model`, `kit_models`) as this
  gear's service identity: before an organization install is recorded (a
  conflict is 400 `KIT_MODEL_CONFLICT` and nothing is recorded), after an
  organization uninstall, and for base kits when an organization's installed
  kits are read (`reconcile_models`). Same-version reconciliation is idempotent
  and captures/adopts known property sources and organization tombstones.
  Overlays are still projected into each
  organization's stored model, not layered; a kit that brings a model is not
  installed for one project (`MODEL_KIT_NOT_FOR_PROJECT`). Without the domain
  model in the assembly, kits install and the model is left alone.
- Whether a kit applies, for another gear (`port.rs` `KitPresence`,
  registered in the ClientHub): for a project its effective kits (base ∪
  organization ∪ its own), for an organization base ∪ its own, as
  `GET /installed-kits` answers. studio-environments asks it for
  `constructor-research` (levels organization and project, opt-in, a
  compiled-in `builtin/constructor-research.kit.json`): the project's answer
  before a build, deploy or rollback or a project's own Research environment,
  the organization's before an organization's Research environment or its
  Research projects/hardware listing (400 `failed_precondition`,
  `KIT_NOT_INSTALLED`); status, logs, uninstall and removal stay. Design:
  `docs/design/studio-kits.md` §3.13.
- `project-lifecycle` is the first built-in kit with a model: the type
  `project-lifecycle-phase`, `project.phase` / `phase_owner` / `phase_since`,
  the tab `project.phases` and the phase lifecycle. Its function is
  `phase.rs`: `GET`/`PUT /project-phase?project_id=` (moves only along a
  declared transition, `NO_SUCH_TRANSITION`; `KIT_NOT_INSTALLED` where it
  does not apply; written as the caller, `DOMAIN_EDIT_REQUIRED` when the PDP
  refuses) and `GET /project-phases?organization_id=`. MCP: `project_phase`,
  `project_phase_set`, `project_phases`.
- Inbox sources (ADR-0068 §6), `inbox.rs`: a kit's `inbox` in its
  `kit.json`, of two kinds. `query` (default): `{id, label, query, title?,
  workspace_field?}`, the query a domain query naming its `type`, `"$me"` the
  person. `endpoint`: `{id, label, kind: "endpoint", path, title?}`, `path` a
  literal `GET` route of Studio's own that the kit's `permissions.reads`
  names, answering `{items: [{id, title?, workspace_id?, url?, due_at?,
  overdue?}]}` for the caller. `GET /inbox-sources` (`?organization_id=`,
  members) lists those of the kits installed for the whole organization at
  their installed version, plus the `endpoint` sources of a built-in kit a
  project may install alone; studio-user's `GET /me/inbox` runs them as the
  person (a query, or a call of the route). MCP `kits_inbox_sources`.
  Project lifecycle brings `phase-waiting`; Constructor Research
  `deploy-failed` and `sign-in-expires`.

- A kit's micro-frontends at run time (ADR-0068 phase 5), `bundles.rs`:
  `STUDIO_KIT_BUNDLES_DIR` names a directory whose every subdirectory with a
  `kit.gdl` naming bundles (`mfe = [path("mfe/<package>")]`, GDL 1.7) is a
  kit on the `organization` shelf (`source` = `bundle-dir`), at the version
  its passport states; a slug the library already holds is left out, and so
  is a kit whose passport does not read (a warning, not a stop). A named
  directory that cannot be read stops the gear at start.
  `GET /studio-kits/v1/mfe-manifests?organization_id=|project_id=` (any member,
  scope as `installed-kits`) lists each package of the effective kits with
  bundles at their installed version: `mfe-manifest.json` as `config` (null
  with `error` when it does not read) and `base_path`;
  `GET /studio-kits/v1/kits/{kit_slug}/{version}/mfe/{grant}/{package}/{*file}`
  serves the files, anonymous (the shell's loader sends no token) and guarded
  by `grant`, an HMAC of slug and version under `STUDIO_KIT_BUNDLE_KEY` (else a
  key drawn at start: set it when there is more than one replica). Only a
  bundle's own file types, never HTML, hidden files or anything outside the
  package. The demo is `studio-frontend-prototype/examples/kits/hello-kit`;
  the design is `docs/design/studio-kits.md` §3.12.
- The prototype flow and the installer inside the session are in the
  repository-root [`docs/kit-registry-prototype.md`](../../../docs/kit-registry-prototype.md).
