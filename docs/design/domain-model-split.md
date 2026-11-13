---
type: design
status: proposed
owner: studio-team
---

# Splitting the Studio domain model: what stays in the core, and which kit brings the rest

- [ ] `p2` - **ID**: `cpt-studio-design-domain-model-split`

The analysis behind [ADR-0070](../adr/0070-studio-keeps-a-core-model-and-each-kit-brings-the-types-its-screens-show.md)
(issue constructorfabric/studio-web#1025, part of #998). It assigns every type of
Studio's own model (`studio-backend/src/domain_model/ontology.studio.json`, 63 types in
11 buckets) to the core or to one kit, or drops it. It also lists the relations that would
cross from the core into a kit type.

The counts below describe the original 63-type audit. The current seed also has
the storage-independent core `file` base (ADR-0070): 64 types, with 44 in core.
The ownership of the other types is unchanged.

The owners below include the decisions taken on ADR-0070's open questions on 2026-11-10
(ADR-0070 §7): `milestone` goes to project-lifecycle, `pull-request` to a new
`project-git` kit, `policy` stays in project-specs, and `gears` and the numbered
`kit.packages_*` relations are dropped.

Read with ADR-0066 (Studio's own model, gear-held types), ADR-0067 §6 (a kit brings the
rest; a kit never holds a type), ADR-0068 §1–3 and §8 (what the shell is; kit
contributions; kit type namespace) and ADR-0069 (base kits).

## Table of Contents

<!-- toc -->

- [1. How the owner was chosen](#1-how-the-owner-was-chosen)
- [2. What the code says that the issue did not](#2-what-the-code-says-that-the-issue-did-not)
- [3. The 63 types](#3-the-63-types)
- [4. Counts](#4-counts)
- [5. Relations that cross from the core into a kit](#5-relations-that-cross-from-the-core-into-a-kit)
- [6. Relations between two kits](#6-relations-between-two-kits)
- [7. Shell code that reads a kit's type](#7-shell-code-that-reads-a-kits-type)
- [8. Gear-held types outside the 63](#8-gear-held-types-outside-the-63)
- [9. Sources](#9-sources)

<!-- /toc -->

## 1. How the owner was chosen

These rules are applied in order. The first one that decides wins.

1. **A base other types extend is core.** A kit cannot take away or retype (ADR-0067 §6).
   A base that disappears with a kit would leave an organization's uploaded types without
   their inherited fields. This covers the system primitives, `managed-object`,
   `organization-entity` and `metric`.
2. **What the shell of ADR-0068 §1 holds is core.** This covers the levels, people and
   roles, sources, saved views and filters, the generic screens, the kit library, the
   journal and the rule engine.
3. **A type a core type must reference is core.** One example is `managed-object.records →
   transition`. Another is `kit.introduces_type → template`: a kit ships templates
   (ADR-0068 §3).
4. **A type that every gear's storage needs is core.** `sync-state` is the marker that
   every ADR-0066 §8a move writes.
5. **Otherwise the type belongs to the kit whose screen shows it.** This is the issue's
   rule. The screen is the `shows` relation in the seed, or the `kit` that the portal's
   `mfe.json` gives the section that reads the type.
6. **A type that no screen shows goes to the kit its concept belongs to.** Where no
   built-in kit fits, a new kit is proposed: `assistant`, which ADR-0068 §7 already names
   as "the chat assistant", and `project-git` (ADR-0070 §7, decision 2).
7. **A type that duplicates another, with no reader and no writer, is dropped**, not
   moved. Only `gears` is dropped, because the catalogue keeps `gear` (ADR-0070 §7,
   decision 4).

## 2. What the code says that the issue did not

- **Studio's own model is not the 140-type file.** The gear seeds every organization from
  `ontology.studio.json` (63 types; `ontology.rs` `STUDIO_MODEL_JSON`).
  `ontology.core.json` (140 types) is used only by the tests, as an upload
  (`PRODUCT_MODEL_JSON`, `#[cfg(test)]`). `docs/design/studio-domain-model.md` §1.1 still
  says otherwise. **The domain client generator reads the 140-type file**
  (`scripts/gen-domain-client.mjs`, `INPUT`). So `model.gen.ts` has types no organization
  has, such as `automation-rule` and `workflow-run`, and lacks two that every organization
  has (`organization`, `workspace`).
- **Most of the 63 types have no reader or writer outside the seed.** The following types
  are really written as domain objects:
  - The artifact sync writes `repository`, `commit`, `pull-request`, `repository-file` and
    `text-content` (held), and `work-item`, `comment` and `finding` (shared).
  - `studio-documents` writes `review-request` and `approval` (held) and
    `lifecycle-stage` (open).
  - The catalogue's publication queue writes `approval-request` (open).
  - The reports mirror writes `org-unit`, `team`, `person` and `membership`.
  - The tenant sweep writes `organization`, `workspace` and `project`.
  - Every gear's move writes `sync-state` as a marker.
  - The old prototype writes `view` (saved views) and `milestone` (Timeline).

  The other types are vocabulary from the product team's model. Moving them costs nothing
  but a test.
- **The tabs are relations on core types.** `organization`, `workspace` and `project`
  carry 25 `shows` relations. 11 of them point at a type that would become a kit's, and 7
  more point at gear-held types that exist only after a gear's `ensure_type`
  (`project-product`, `gear`, `deployment`, `deployment-environment`, `budget`,
  `project-type`). In the seed those 7 are unresolved. A tab is a kit's contribution
  (ADR-0068 §2), so every `shows` relation whose tab is a kit's moves to that kit's
  overlay, even when its target stays core. Examples are `project.artifacts →
  repository-file` (project-artifacts) and `project.people → person` (project-team).
- **A gear declares its types itself, whatever kit is installed.** `ensure_type`
  (`domain_model/port.rs` 307–340) adds a missing type with `origin: studio` and marks it
  `held_by`. When a type's kit is uninstalled, a gear that still writes the type adds it
  back on its next touch. The ADR therefore separates two parts: the gear's need, which is
  always present, and the kit's declaration, which is present only while the kit is
  installed.
- **The artifact sync declares 15 relations on `system-object`**
  (`artifact_ingest/model_store.rs` 79–162, `RELATION_SOURCE`). Two of them, `closes_item`
  and `part_of_item`, target `work-item`, which becomes a kit type. These relations are
  the gear's, not the seed's, but they hang off the root base.
- **The issue's suggestions that the code argues against:**
  - `document` and `template` both look like Specs types. `template` stays core because
    `kit.introduces_type` and `object-type.requires_template` point at it, and a kit
    ships templates as material (ADR-0068 §3). `document` can move, because
    the only core relation to it is `project.documented_by`, which moves with it.
  - `metric` is a base. `cost-metric` (costs) and `delivery-metric` (reports) extend it
    in the product team's model, so it is core.
  - `evidence` is referenced from three kits (`approval`, `report`, `risk`), so it is core
    rather than any one kit's.
  - `pull-request` is synced with commits and branches by the same sync, and the shell
    reads it: the Inbox source `pull-requests` (`user_profile/inbox.rs` 11–23), the project
    status's "pull requests waited a week" (`organizations/status.rs` 19) and the
    organization Overview's stuck pull requests (`organizations/overview.rs` 7, 23, 51).
    The first draft kept it in core for that reason. **Decided 2026-11-10: it goes to
    `project-git`.** A pull request is a Git host's workflow, not a source. The core keeps
    what the editor and Sources need: `repository`, `branch`, `commit`, `repository-file`
    and `text-content`. The shell's readers now depend on the kit being installed, or they
    degrade (§7).
  - `activity` backs the shell's organization tab "Background work"
    (`organization.tasks`, `organization-mfe` without a kit) as well as the project's
    Activity kit. It is core, and the project tab relation moves.
  - `review-request` and `approval` go to `project-specs`, not a new collaboration kit.
    `studio-documents` holds them, their subjects are documents and bindings
    (`documents/service.rs` 873), and ADR-0068 §6 puts their Inbox source in Specs.
  - `milestone`: the Timeline section that shows it is `project-activity`'s
    (`projects-mfe/mfe.json` 197). **Decided 2026-11-10: the type goes to
    `project-lifecycle`**, because milestones are the plan and the Timeline only shows
    them. The Timeline section stays in project-activity and declares that it needs the
    `milestone` type, so the shell mounts it only where project-lifecycle is installed
    (ADR-0070 §2, "A section that needs another kit's type").

## 3. The 63 types

GTS id: every type's node type is `gts.cf.studio.domain.<leaf>.v1~` (`gts.rs`
`node_type_id`, `-` → `_`). The column below gives only the `<leaf>`.

Abbreviations in the citations: **seed** = `ontology.studio.json`;
**ingest** = `artifact_ingest/model_store.rs`; **reviews** =
`documents/review_store.rs`; **process** = `documents/process_store.rs`;
**mirror** = `reports/mirror.rs`; **tenants** = `domain_model/tenant_objects.rs`;
**contents** = `kit_registry/contents.rs`; **poc** = `studio-frontend-poc/src/` (the old
prototype); **fx** = `studio-frontend-prototype/src-app/mfe_packages/` (the FrontX
portal). "Generic only" means that the generic routes and MCP tools (`/objects`, `/query`,
`/mutate`, `domain_model_*` in `domain_model/mcp.rs`) are the only readers. Backend paths
are under `studio-backend/src/`.

| # | Type | `<leaf>` | Bucket | Held / stored by | Used by | Owner | Why |
|---|---|---|---|---|---|---|---|
| 1 | system-object | `system_object` | system-primitives | none. The artifact sync hangs its 15 relations here (ingest 162, 289) | every type's root; `ontology.rs` | core | Rule 1: the root base |
| 2 | entity | `entity` | system-primitives | none | base | core | Rule 1 |
| 3 | node | `node` | system-primitives | none | base of `managed-object` | core | Rule 1 |
| 4 | edge | `edge` | system-primitives | none | base of `relation`; every relation property `extends: edge` | core | Rule 1 |
| 5 | record | `record` | system-primitives | none | the base every gear's `TypeNeed` names (ingest 232, `catalog_graph/model_sink.rs` 247, reviews 96, `model_metadata.rs`) | core | Rule 1: gear types extend it |
| 6 | link | `link` | system-primitives | none | base | core | Rule 1 |
| 7 | managed-object | `managed_object` | graph | none | base of 20 seed types; `domain_model/mutate.rs`; poc `object-attributes.tsx` | core | Rule 1 |
| 8 | relation | `relation` | graph | none | the meta-model; `mutate.rs`, `ontology.rs` | core | Rule 2: the meta-model |
| 9 | object-type | `object_type` | graph | none (the model's own `object_type` nodes are `domainmeta`, `gts.rs` 33) | `project.model` shows it (the "Domain model" tab); `tenant.registers`, `kit.packages` | core | Rule 2: the meta-model. Its tab relation moves to `project-domain-model` |
| 10 | metric | `metric` | graph | none | abstract base; `cost-metric` and `delivery-metric` extend it in `ontology.core.json` | core | Rule 1. The issue proposed org-reports |
| 11 | team | `team` | identity | written by the reports mirror (mirror 37) | Profile reads it (`user_profile/service.rs` 474); `organization-mfe` People; ADR-0068 §1 | core | Rule 2: people |
| 12 | person | `person` | identity | written by the reports mirror (mirror 38) | Profile (`user_profile/service.rs` 472); org and project People tabs (`organization.people`, `project.people`) | core | Rule 2. `project.people` (Team tab) moves to `project-team` |
| 13 | tenant | `tenant` | identity | none (tenants live in account-management) | base of levels' meaning; Admin › Project tenants | core | Rule 2: levels |
| 14 | role | `role` | identity | none (roles are the access config) | `role.bundles → permission`; Admin › Access | core | Rule 2: roles |
| 15 | role-assignment | `role_assignment` | identity | none | `team.receives`, `membership.receives` | core | Rule 2 |
| 16 | org-unit | `org_unit` | identity | written by the reports mirror (mirror 36) | poc `reports.tsx` | core | Rule 2: identity, written by a kit's gear (see §7) |
| 17 | ownership | `ownership` | identity | none | `person.holds`, `team.holds` | core | Rule 2: explicit ownership boundaries |
| 18 | connector | `connector` | connectors | none. Connections are `connector-connection`, held by `studio-connector` (`connectors/gts.rs` 90) | `organization.connectors` shows it (Connections tab, kit `org-connections`, contents 531); Admin › Integrations (shell) | core | Rule 2: sources. The tab relation moves to `org-connections` |
| 19 | project | `project` | planning | one object per project, by the tenant sweep (tenants 1–13) | the level; `project-mfe` Overview, Sources, Settings | core | Rule 2: levels |
| 20 | organization | `organization` | planning | one object per organization (tenants) | the level; `organization-mfe` | core | Rule 2 |
| 21 | workspace | `workspace` | planning | one object per workspace (tenants) | the level; `organization-mfe` Workspaces | core | Rule 2 |
| 22 | milestone | `milestone` | planning | none (members' objects) | poc `project-timeline.tsx` 20 (Timeline, queried by type); fx `projects-mfe/mfe.json` 197 gives Timeline to `project-activity` | **project-lifecycle** | Decided 2026-11-10: milestones are the plan. The Timeline section stays in project-activity and needs the type (ADR-0070 §2) |
| 23 | risk | `risk` | planning | none | generic only. The "at risk" verdict in `organizations/status.rs` is a computed level, not this type | **project-lifecycle** | Rule 6: project status and phases |
| 24 | kit | `kit` | kit-management | none (catalogue kits are `catalog-kit`, `catalog_graph`; installations `kit-installation`, `kit_registry/service.rs` 24) | `project.kits` shows it (the Kits tab is the shell's `kits-mfe`); `tenant.distributes`, `membership.publishes` | core | Rule 2: the kit library |
| 25 | work-item | `work_item` | planning | the artifact sync (issues, ingest 61), shared with members (ingest 224) | `system-object.closes_item` and `part_of_item` (gear relations); Issues kit "Create issue…" records issues; `project.scopes` | **project-issues** | Rule 6: tracker issues. The issue proposed project-lifecycle |
| 26 | pull-request | `pull_request` | collaboration | the artifact sync, held (ingest 62) | Inbox source `pull-requests` (`user_profile/inbox.rs` 22); project status (`organizations/status.rs` 19); organization Overview's stuck pull requests (`organizations/overview.rs` 23); Tests tab's open pull requests (contents 231); `repository.hosts` | **project-git** (new) | Decided 2026-11-10: a Git host's workflow, not a source. Each shell reader depends on the kit or degrades (§7) |
| 27 | comment | `comment` | collaboration | the artifact sync, shared with members (ingest 66, 224) | poc `activity-view.tsx` 25 (Activity's Comments); status signal "unanswered comment threads → Open Activity" (`organizations/status.rs` 755) | **project-activity** | Rule 5. It does not go with `pull-request` to project-git: comments hang off pull requests, issues and documents (`comment.subject_kind`, ingest 66), and Activity is the screen that shows them all |
| 28 | repository | `repository` | content | the artifact sync, held (ingest 60) | `project.sources` (Sources, shell); `project.uses`; Components, Releases, Specs | core | Rule 2: sources |
| 29 | branch | `branch` | content | none in the model (branches are read live, `project_sources.rs`) | Sources; Releases builds | core | Rule 2: sources |
| 30 | commit | `commit` | content | the artifact sync, held (ingest 67) | `repository.records`; Releases, Artifacts | core | Rule 2: sources |
| 31 | repository-file | `repository_file` | content | the artifact sync, held (ingest 63) | `project.artifacts` shows it (kit `project-artifacts`, contents 249); the editor opens files | core | Rule 2: sources. The tab relation moves to `project-artifacts` |
| 32 | document | `document` | content | none. Specs are `studio-document`, held by `studio-documents` (`documents/model_table.rs` 83) | `project.specs` shows it (Specs, kit `project-specs`, contents 183); `project.documented_by`; base of `policy` | **project-specs** | Rule 5 |
| 33 | text-content | `text_content` | content | the artifact sync, held (file content, ingest 68) | `template.defined_by`; field type of `comment.body`, `approval.reason`, `template.content` | core | Rule 3: the core `template` needs it |
| 34 | template | `template` | content | none | `workspace.types` shows it ("Document types", kit `project-specs`, contents 185); `kit.introduces_type`, `object-type.requires_template` | core | Rule 3: core `kit` and `object-type` point at it. The tab relation moves to `project-specs`. The issue proposed project-specs |
| 35 | approval | `approval` | collaboration | `studio-documents`, held (reviews 40, 74) | Specs review panel (poc `documents.tsx`); `approval-request.collects_decisions` | **project-specs** | Rule 5: a review's verdict |
| 36 | notification | `notification` | collaboration | none (the bell is runs ending, `app/live/completedWork.ts`) | `event.routes`, `comment.notifies`, `approval.notifies`; ADR-0067 §4 `notify` action | core | Rule 2: the shell's bell and the rule engine's `notify` |
| 37 | worker | `worker` | automation | none | `action.runs_on` | core | Rule 2: where an action runs, for the rule engine (ADR-0067 §4–5) |
| 38 | event | `event` | automation | none (the journal of ADR-0067 §2 is a table) | `event.routes`; the events catalogue | core | Rule 2: events (the issue's core list) |
| 39 | workflow | `workflow` | automation | none | `project.enables`, `project.organizes`; ADR-0067 names it an engine type | core | Rule 2 and 3: the rule engine kits bring objects for |
| 40 | action | `action` | automation | none | `workflow.orchestrates`, `activity.performed_via` | core | Rule 2 and 3 |
| 41 | evidence | `evidence` | automation | none | `approval.records` (specs), `report.records` (reports), `risk.assessed_as` (lifecycle) | core | Rule 3: shared by three kits. The issue proposed project-issues |
| 42 | policy | `policy` | governance | none | generic only; extends `document` | **project-specs** | Rule 1, inverted: it extends a Specs type, so it goes where its base goes. Decided 2026-11-10: project-specs until a governance kit exists |
| 43 | model | `model` | ai | none (model prices are `model-price`, `usage/mod.rs` 62) | generic only; `message.generated_by` | **assistant** (new) | Rule 6: AI |
| 44 | tool | `tool` | ai | none | generic only | **assistant** (new) | Rule 6 |
| 45 | message | `message` | collaboration | none (the assistant's chat is not stored as objects) | `person.authors`; role `system/user/assistant/tool`, `usage`, `generated_by → model` | **assistant** (new) | Rule 6: an assistant message, not a person's chat |
| 46 | membership | `membership` | identity | written by the reports mirror (mirror 39) | Profile (`user_profile/service.rs` 473); `notification.targets` | core | Rule 2 |
| 47 | permission | `permission` | identity | none (permissions are the access config) | `role.bundles` | core | Rule 2 |
| 48 | view | `view` | planning | none (members' objects) | saved views: poc `views-model.ts` 340, `views.tsx`; `project.owns`, `membership.owns`; parity "Saved views… shell" | core | Rule 2: saved views are the shell's (ADR-0068 §1) |
| 49 | sync-state | `sync_state` | connectors | every ADR-0066 §8a move writes its marker: ingest 367, `catalog_graph/model_sink.rs` 315, `documents/data.rs` 491, reviews 359, `model_metadata.rs` 678 | the gears' storage | core | Rule 4 |
| 50 | conflict | `conflict` | connectors | none | `conflict.concerns → managed-object` | core | Rule 2: sync of sources |
| 51 | actor | `actor` | automation | none (the journal's actor is a field) | `transition.performed_by` | core | Rule 2: actors |
| 52 | finding | `finding` | automation | the artifact sync, shared with members (spec findings, ingest 65, 224) | `project.issues` shows it (Issues, kit `project-issues`, contents 212); `fx/issues-mfe` | **project-issues** | Rule 5 |
| 53 | check | `check` | automation | none (CI runs are `ci-run`/`ci-job`, ingest 70–71) | `project.tests` shows it (Tests, kit `project-tests`, contents 231) | **project-tests** | Rule 5 |
| 54 | report | `report` | automation | none (report sources are `report-source`, held by `studio-reports`, `reports/store.rs` 167) | `organization.reports` shows it (Reports, kit `org-reports`, contents 199; `fx/reports-mfe`) | **org-reports** | Rule 5 |
| 55 | transition | `transition` | automation | none | `managed-object.records → transition` (core base) | core | Rule 3 |
| 56 | review-request | `review_request` | collaboration | `studio-documents`, held (reviews 39, 51) | Inbox source `review-requests` (`user_profile/inbox.rs` 21); poc `documents.tsx`, `review-requests.ts`; `pull-request.requests_reviews` | **project-specs** | Rule 5. ADR-0068 §6 |
| 57 | approval-request | `approval_request` | collaboration | the catalogue's gear-publication queue, open (`components_catalog/registry_curation.rs` 43) | Platform › Publication requests (kit `components`, contents 310) | **components** | Rule 5 |
| 58 | lifecycle-stage | `lifecycle_stage` | kit-management | `studio-documents`' process catalogue, open (process 48, 51) | stages of a project type: "Templates & phases" (`workspace.ptypes`, kit `project-lifecycle`, contents 169) | **project-lifecycle** | Rule 5 |
| 59 | activity | `activity` | automation | none | `organization.tasks` (Background work, shell); `project.activity` (kit `project-activity`, contents 258); `lifecycle-stage.defines` | core | Rule 2: the shell's run list. The project tab relation moves |
| 60 | gears | `gears` | kit-management | none. The catalogue writes `gear` (`catalog_graph/model_sink.rs`), not `gears` | generic only; `kit.packages_9` (dropped too) | **dropped** | Rule 7. Decided 2026-11-10: it duplicates the catalogue's `gear` and nothing reads or writes it. An organization whose members created `gears` objects keeps them as a dormant type (ADR-0070 §4) |
| 61 | dependency | `dependency` | planning | none (`documents/delivery.rs` 14 is a delivery limit kind, not this type) | generic only | **project-lifecycle** | Rule 6: blocks/requires between a project's objects |
| 62 | assignment | `assignment` | planning | none (Admin › People's "assignment" is a role grant) | generic only; who works on what in which `job_role` | **project-team** | Rule 6: "who works on it and in which role" (`kit_registry/service.rs`, project-team) |
| 63 | organization-entity | `organization_entity` | identity | none | abstract base of `team`, `person`, `org-unit` | core | Rule 1 |

## 4. Counts

| Owner | Types | Count |
|---|---|---|
| core | system-object, entity, node, edge, record, link, managed-object, relation, object-type, metric, organization-entity, tenant, org-unit, team, membership, person, role, permission, role-assignment, ownership, connector, sync-state, conflict, repository, branch, commit, repository-file, text-content, template, project, organization, workspace, view, notification, workflow, action, worker, evidence, actor, transition, event, activity, kit | **43** |
| project-specs | document, policy, review-request, approval | 4 |
| project-lifecycle | risk, dependency, lifecycle-stage, milestone | 4 |
| assistant (new) | model, tool, message | 3 |
| project-issues | work-item, finding | 2 |
| project-git (new) | pull-request | 1 |
| project-activity | comment | 1 |
| components | approval-request | 1 |
| project-tests | check | 1 |
| org-reports | report | 1 |
| project-team | assignment | 1 |
| dropped | gears | 1 |
| project-artifacts, org-connections, project-domain-model | no type of their own; each takes a tab relation (§5) | 0 |
| org-costs, org-infrastructure, product-releases, studio-api-docs | no seed type. Their types are gear-held and outside the 63 (§8) | 0 |
| **total** | 43 core + 19 in 10 kits + 1 dropped | **63** |

The 43 core types fall into five groups:

| Group | Count | Types |
|---|---|---|
| Bases and the meta-model | 10 | system-object, entity, node, edge, record, link, managed-object, relation, object-type, metric |
| Identity and levels | 13 | organization-entity, tenant, org-unit, team, membership, person, role, permission, role-assignment, ownership, project, organization, workspace |
| Sources and their sync | 8 | connector, sync-state, conflict, repository, branch, commit, repository-file, text-content |
| The shell's own mechanisms | 6 | kit, view, activity, notification, event, actor |
| Engine types and shared targets | 6 | workflow, action, worker, transition, evidence, template |

Twelve of the 43 go beyond the issue's list of core types: `metric`, `text-content`,
`sync-state`, `conflict`, `view`, `notification`, `workflow`, `action`, `worker`,
`transition`, `evidence` and `template`. §2 and the table give the reason for
each. The core is small in meaning but not in count. Most of it is vocabulary that nothing
writes yet.

## 5. Relations that cross from the core into a kit

A core type must not declare a relation to a kit type. Each one listed here moves into the
overlay of the kit that brings its **target**. ADR-0067 §6 lets a kit add relations to
Studio's types. With the kit absent, the relation is not declared, the same way
`Ontology::unresolved_relation_targets` (`ontology.rs` 473–476) already treats a target
the model lacks.

**Model relations from the seed** (computed from `ontology.studio.json`, relation
properties with `extends: edge`):

| Relation | Target (owner) | Moves to | Breaks? |
|---|---|---|---|
| `project.scopes` | work-item (project-issues) | project-issues overlay | no |
| `project.documented_by` | document (project-specs) | project-specs overlay | no |
| `project.tracks` | risk (project-lifecycle) | project-lifecycle overlay | no |
| `repository.hosts` | pull-request (project-git) | project-git overlay | no for the model. The shell's readers of pull requests are listed in §7 |
| `actor.authors` | comment (project-activity) | project-activity overlay | no |
| `person.authors` | message (assistant) | assistant overlay | no |
| `kit.introduces_type_22` | finding (project-issues, as the current resolver reads `type: Finding`) | project-issues overlay | preserve current behavior; see the ambiguity below |

The ownership-boundary regression check also includes links, not only edges.
`kit.introduces_type_22` has `type: Finding` but `relation: security-finding`.
The current backend resolves the type expression and therefore targets `finding`;
`security-finding` is absent from the Studio seed. The split must preserve that
observable behavior. Correcting the ambiguous reference is a separate compatibility
change, not a silent retarget during the ownership migration. The boundary test
records this dependency explicitly so it cannot disappear from the migration queue.

**Dropped, not moved** (decided 2026-11-10): the numbered packaging relations on `kit`,
`kit.packages_2` … `kit.packages_14`. They come from the product team's model and point at
`relation-type`, `terminology-override`, `reference-catalog`, `workflow`, `action`,
`validator`, `template`, `gears`, `ui-extension`, `prompt-template`, `tool`,
`agent-definition` and `connector-type`. `kit.packages → object-type` already says that a
kit packages types, and what a kit brings is its manifest (`kit.gdl`, ADR-0068 §3), not a
relation. `kit.packages` and `kit.introduces_type → template` stay.

**Tabs (`shows`) on the core levels.** All of these move to the kit that owns the tab.
"Breaks?" means the tab disappears without the kit, which is the intent:

| Relation | Target | Tab | Moves to |
|---|---|---|---|
| `project.issues` | finding | Issues | project-issues |
| `project.specs` | document | Specs | project-specs |
| `project.tests` | check | Tests | project-tests |
| `organization.reports` | report | Reports | org-reports |
| `project.artifacts` | repository-file (core) | Artifacts | project-artifacts |
| `project.activity` | activity (core) | Activity | project-activity |
| `project.people` | person (core) | Team | project-team |
| `project.model` | object-type (core) | Domain model | project-domain-model |
| `organization.connectors` | connector (core) | Connections | org-connections |
| `workspace.types` | template (core) | Document types | project-specs |
| `workspace.ptypes` | project-type (gear) | Templates & phases | project-lifecycle |
| `project.components` | project-product (gear) | Product | product-releases |
| `project.releases` | deployment (gear) | Releases | product-releases |
| `project.parts` | gear (gear) | Components | components |
| `organization.gears` | gear (gear) | Components | components |
| `organization.environments` | deployment-environment (gear) | Infrastructure | org-infrastructure |
| `organization.costs` | budget (gear) | Costs | org-costs |

These stay core, because the tab is the shell's: `project.overview`, `project.sources`,
`project.kits`, `organization.org`, `organization.projects`, `organization.people`,
`organization.tasks`, `workspace.projects`, `workspace.about`.

**Gear relations on a core type** (not in the seed, declared by a gear's `TypeNeed`):

| Relation | Target | Declared by | Breaks? |
|---|---|---|---|
| `system-object.closes_item`, `part_of_item` | work-item (project-issues) | `studio-artifact-ingest` (ingest 152–159, 289) | **Yes.** The gear writes these edges whatever kit is installed. Without project-issues the edge type exists but its target type is dormant or absent. The gear's layer keeps the relation, and screens do not offer it (ADR-0070 §4) |
| `system-object.finding_on`, `comment_on`, `decision_on` | `system-object` | ingest 116–140 | no: the target is the root. Their sources become kit types |

## 6. Relations between two kits

These are not core crossings, but a kit's relation to another kit's type has to survive
the other kit's absence. Each one stays in the source kit's overlay and is unresolved, not
offered, while the target's kit is absent. None needs a hard dependency (ADR-0068 open
question 2):

| Relation | From → to |
|---|---|
| `milestone.tracks_2 → work-item` | project-lifecycle → project-issues |
| `risk.mitigated_by → work-item` | project-lifecycle → project-issues |
| `work-item.implemented_by → pull-request` | project-issues → project-git |
| `pull-request.has_comments → comment` | project-git → project-activity |
| `pull-request.requests_reviews → review-request` | project-git → project-specs |
| `document.has_comments → comment` | project-specs → project-activity |
| `check.belongs_to → report` | project-tests → org-reports |
| `check.produced → finding` | project-tests → project-issues |
| `report.contains → finding`, `report.contains_2 → check` | org-reports → project-issues, project-tests |
| `approval-request.collects_decisions → approval` | components → project-specs |

**One section that needs another kit's type:** project-activity's Timeline section shows
`milestone`, which project-lifecycle brings. The section declares that it needs the type,
and the shell mounts it only where the type is installed (ADR-0070 §2). Activity itself
does not depend on project-lifecycle.

**One inheritance edge between kits:** `policy` extends `document`. Both go to
project-specs, so nothing breaks. If a governance kit later takes `policy`, it has to
depend on project-specs.

## 7. Shell code that reads a kit's type

Model relations are not the only coupling. These pieces of the shell or of a core gear
read a kit's types or point at its tabs today:

| Where | Reads | What happens without the kit |
|---|---|---|
| `user_profile/inbox.rs` 21 (`review-requests`) | review requests through `studio-documents` | **Done (phase 10).** project-specs' `kit.json` declares it, a `studio` Inbox source (`docs/design/studio-kits.md` §3.11). Without the kit installed for the organization the Inbox reads no review requests |
| `user_profile/inbox.rs` 22 (`pull-requests`) | pull requests through `studio-artifact-ingest` | **Done (phase 10).** project-git's `kit.json` declares it, a `studio` Inbox source. Without the kit the Inbox has no pull-request items |
| `organizations/status.rs` 19 (a project "at risk" because pull requests waited a week) | open pull requests | **Done (phase 10).** The `stuck` and `nobody` signals name project-git and are left out where the kit is not installed for the project. The verdict is computed from the remaining signals |
| `organizations/overview.rs` 7, 23, 51 and fx `organization-mfe` Overview (stuck pull requests, "PRs on people") | pull requests of every workspace | **Done (phase 10).** Without project-git installed for the organization the pull requests are not read: the `pulls` need is not listed, `waiting_on` and `delivery`'s counts are null, and the portal draws no delivery tile. The other blocks stay. Each need names its kit (`org-costs`, `components`, `project-git`) and is dropped without it |
| Tests tab (`project-tests`, contents 231: `GET /studio-artifact-ingest/v1/open-pull-requests`, `POST /studio-documents/v1/pull-request-checks`) | open pull requests and their document checks | **Degrades.** The pull-request part of Tests needs the `pull-request` type, the same way Timeline needs `milestone`. CI runs and conformance stay |
| `organizations/status.rs` 755–770 and the signals naming `issues`, `specs`, `activity` | findings, specs, comment threads | **Done (phase 10).** Each signal and path step carries `kit` (`project-specs`, `project-issues`, `project-domain-model`, `product-releases`, `project-activity`; null for Sources and the IDE) and is dropped when that kit is not installed for the project; a dropped step is never current, and an unread source of an absent kit is not named in `unread` |
| `reports/mirror.rs` 36–39 | writes core identity types from a kit's gear | Nothing breaks: a kit's gear may write core types. It shows that the direction kit → core is fine |
| `documents/process_store.rs` 51 | `studio-documents` writes `lifecycle-stage` (a project-lifecycle type) | The gear's `ensure_type` re-adds the type. ADR-0070 §3 separates the gear's need from the kit's declaration |
| `scripts/gen-domain-client.mjs` | every type of `ontology.core.json` | Generated names for types an organization may not have (ADR-0070 §5) |
| poc `level-tabs-ui.tsx`, `views.tsx`, `object-attributes.tsx` (generic tab, saved views, attributes; not yet in the FrontX portal, parity "todo") | any type named by a `shows` relation or a saved view | A saved view of an absent type answers 400 today (ADR-0070 §5) |

## 8. Gear-held types outside the 63

A gear adds these through `ensure_type`, and they are not in the seed. They are listed so
that the phases cover them. Their declarations stay in the gear's layer, and their tabs
and screens belong to the kit named here:

| Gear | Types | Kit |
|---|---|---|
| `studio-documents` | `studio-document`, `document-binding`, `document-analysis`, `spec-extraction`, `spec-judgement`, `fact-review`, `finding-decision`, `glossary-decision`, `application-part`, `delivery-scope`, `delivery-limit`, `delivery-scope-version`, `document-type`, `decision`, `capability` | project-specs; `spec-extraction`, `fact-review`, `finding-decision`, `glossary-decision` with project-domain-model |
| `studio-artifact-ingest` | `source-account`, `mapping-decision`, `ci-run`, `ci-job`, `product-build`, `build-artifact`, `release` | `source-account` core (sources); `ci-*` project-tests; builds and releases product-releases; `mapping-decision` product-releases |
| `studio-components-catalog`, `studio-product` | `gear`, `gear-version`, `gear-profile`, `catalog-kit`, `frontx-package`, `component-field-schema`, `component-snapshot`, `roadmap-item`, `project-gear-repository`, `project-product`, `gear-explanation` | components; `project-product`, `gear-explanation` product-releases |
| `studio-environments` | `deployment-environment`, `environment-binding`, `environment-config-secret`, `deployment` | org-infrastructure; `deployment` product-releases |
| `studio-usage` | `model-price`, `budget` | org-costs |
| `studio-reports` | `report-source` | org-reports |
| `studio-organizations` | `project-type` | project-lifecycle |
| `studio-kits`, `studio-connector` | `kit-installation`, `connector-connection` | core |
| storage infrastructure | `tenant-document`, `text-chunk` | core |

## 9. Sources

- The type list and the relations: `studio-backend/src/domain_model/ontology.studio.json`.
  The crossing relations were computed from its relation properties (`extends: edge`),
  with targets resolved by name or id as `ontology.rs` does.
- Which gear holds what: the `TypeNeed`s in `artifact_ingest/model_store.rs`,
  `documents/review_store.rs`, `documents/process_store.rs`, `documents/data.rs`,
  `documents/model_table.rs`, `catalog_graph/model_sink.rs`,
  `components_catalog/registry_curation.rs`, `reports/store.rs`, and the
  `MODEL_KINDS` of `model_metadata.rs` users.
- Kits and their screens: `kit_registry/service.rs` `builtin_catalogue()`,
  `kit_registry/contents.rs` `builtin_contents()`, and each FrontX package's `mfe.json`
  (`kit` on the entry).
- The portal's state: `studio-frontend-prototype/docs/parity.md`.
