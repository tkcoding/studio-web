---
type: adr
status: proposed
date: 2026-11-10
---

# ADR-0070: Studio keeps a core model, and each kit brings the types its screens show

**ID**: `cpt-studio-adr-domain-model-split`

Status: **proposed** · Date: 2026-11-10 · Builds on ADR-0066 (Studio's own model, gear-held types), ADR-0067 §6 (a kit brings the rest), ADR-0068 (Studio is a shell; kits), ADR-0069 §4 (base kits) · Amends ADR-0068 §8 (the kit namespace is for new types only) and refines ADR-0067 §6 (what "kept, marked as left by the kit" means) · Issue constructorfabric/studio-web#1025, part of #998; ties in with #1000, #1002 and #1004

## Table of Contents

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Considered Options](#considered-options)
  - [Where a moved type's declaration lives](#where-a-moved-types-declaration-lives)
  - [What uninstalling does to a type that has objects](#what-uninstalling-does-to-a-type-that-has-objects)
  - [How existing organizations move](#how-existing-organizations-move)
- [Decision Outcome](#decision-outcome)
  - [1. The core](#1-the-core)
  - [2. What it means that a kit brings a type](#2-what-it-means-that-a-kit-brings-a-type)
  - [3. A gear's need is a declaration of its own](#3-a-gears-need-is-a-declaration-of-its-own)
  - [4. Uninstalling a kit: installed, dormant, absent](#4-uninstalling-a-kit-installed-dormant-absent)
  - [5. How existing organizations move](#5-how-existing-organizations-move)
  - [6. When a type is absent](#6-when-a-type-is-absent)
  - [7. Decisions on the first draft's open questions (2026-11-10)](#7-decisions-on-the-first-drafts-open-questions-2026-11-10)
- [Phases](#phases)
- [Consequences](#consequences)
- [Confirmation](#confirmation)
- [Open questions](#open-questions)
- [More Information](#more-information)

<!-- /toc -->

## Context and Problem Statement

ADR-0067 §6 says that Studio keeps a small core and that kits bring the rest. ADR-0068 §1
puts only levels, people, sources, settings, the Inbox, the generic screens and the
model's core in the shell. Tabs now come from kits: every feature section in the FrontX
portal's `mfe.json` names its `kit`, and `kit_registry/service.rs` `builtin_catalogue()`
lists 15 built-in kits.

The model has not followed. Every organization starts on one seed,
`studio-backend/src/domain_model/ontology.studio.json`, which holds 63 types in 11
buckets, the tabs of the three levels as `shows` relations, and relations among all of
them. `ensure_studio_types` adds whatever a stored model lacks on every
`prepare_model` (`service.rs` 806–825). As a result, an organization that never installs
Tests still has a `check` type and a Tests tab relation. An organization that uninstalls
Reports still has `report`. And `scripts/gen-domain-client.mjs` gives the portal types
from a different file, the product team's 140-type `ontology.core.json`.

The question: **which of the 63 types stay in the core, how does a kit bring the others
without breaking the objects already stored under them, and what happens to those objects
when an organization uninstalls the kit?**

The analysis behind this record, with one row per type, the relations that cross from the
core into a kit, and the shell code that reads kit types, is
[the domain model split](../design/domain-model-split.md).

## Considered Options

### Where a moved type's declaration lives

1. **Keep every type in the seed and mark it with its kit**, hiding it when the kit is
   absent. This is the simplest option. But the seed stays the place where every kit's
   types are edited, and a kit from outside Studio could never do the same.
2. **Move the declaration into the kit's overlay under the same GTS id.** The seed shrinks
   to the core. Stored objects keep matching because their node type
   (`gts.cf.studio.domain.<leaf>.v1~`) does not change.
3. **Re-register under the kit's namespace** (`gts.cf.studio.kit.<slug>.<type>.v1~`,
   ADR-0068 §8) and migrate the objects. This is clean for new types. For existing ones it
   means rewriting every stored object and every relation to it in graph-storage, where a
   deleted key cannot be written again (`docs/design/studio-domain-model.md` §2.2).

**Chosen: 2.** Option 3 stays the rule for types a kit introduces.

### What uninstalling does to a type that has objects

1. **Delete the objects.** This loses data that a reinstall would want back, and
   graph-storage cannot re-ingest a deleted key.
2. **Keep the type as it was.** Then uninstall changes nothing, which is what ADR-0068
   Confirmation forbids ("shows no Product, Builds or Releases tab").
3. **Keep the type and its objects, dormant**: not shown and not writable by people,
   readable by administrators, and back as it was on reinstall.

**Chosen: 3.** This is ADR-0067 §6's "kept, marked as left by the kit", made precise.

### How existing organizations move

1. **Let each keep its stored copy.** Nothing moves. But such an organization never sees a
   core update (#1002), and uninstalling a base kit would hide nothing in it.
2. **Migrate each stored model into layers**: the core of the running version, the gears'
   needs, the base kits' overlays, the organization's kits' overlays, and the
   organization's own layer on top (#1000). An organization with every base kit reads the
   same model as before.

**Chosen: 2**, checked per organization (§5).

## Decision Outcome

### 1. The core

The core is what the shell of ADR-0068 §1 needs, plus what the types a kit brings have to
stand on. The rules, in order:

1. a base that other types extend;
2. what the shell holds (levels, people and roles, sources, saved views, Background work,
   the bell, the kit library, events and actors);
3. a type that a core type must reference;
4. a type that every gear's storage needs;
5. otherwise, the kit whose screen shows the type;
6. failing that, the kit whose concept the type belongs to;
7. a type that duplicates another, with no reader and no writer, is dropped.

Applied to the 63 types, with the decisions of §7, this gives **43 core types, 19 types in
10 kits, and 1 type dropped**:

| Owner | Types |
|---|---|
| core (44, including the storage-independent file base) | bases and meta-model: system-object, entity, node, edge, record, link, managed-object, relation, object-type, metric · identity and levels: organization-entity, tenant, org-unit, team, membership, person, role, permission, role-assignment, ownership, project, organization, workspace · sources: connector, sync-state, conflict, repository, branch, commit, file, repository-file, text-content · shell: kit, view, activity, notification, event, actor · engine and shared targets: workflow, action, worker, transition, evidence, template |
| project-specs | document, policy, review-request, approval |
| project-lifecycle | risk, dependency, lifecycle-stage, milestone |
| assistant (**new built-in kit**, ADR-0068 §7's "Assistant") | model, tool, message |
| project-issues | work-item, finding |
| project-git (**new built-in kit**, §7) | pull-request |
| project-activity | comment |
| components | approval-request |
| project-tests | check |
| org-reports | report |
| project-team | assignment |
| dropped | gears (and the numbered `kit.packages_*` relations) |

Six kits bring no type of their own, only tabs: project-artifacts, org-connections,
project-domain-model, org-costs, org-infrastructure and product-releases. Their screens
show core types or gear-held types outside the 63 (analysis §8).

Where the code argues against the issue's first proposal, the code wins. The analysis
(§2) gives the reasons:

- `template`, `metric` and `evidence` stay core.
- `review-request` and `approval` go to project-specs rather than a new collaboration kit.

The first draft also kept `pull-request` in the core and gave `milestone` to
project-activity. §7 changes both.

The core also has a concrete, storage-independent `file` base. `repository-file`
extends it without changing its entity or graph type id; a kit can introduce another
file subtype with its own source-specific fields. Existing organization fields and
explicit custom bases survive the migration.

### 2. What it means that a kit brings a type

A kit **brings** a type when the type's declaration arrives in the kit's model overlay
(ADR-0067 §6, the shape an upload has). The declaration covers the type's fields, its
relations, its tabs, and later its lifecycle and events.

- **Same id.** A type that was in Studio's model keeps its entity id and its node type
  `gts.cf.studio.domain.<leaf>.v1~`. Objects stored before the move are objects of the
  brought type, with nothing rewritten. ADR-0068 §8's `gts.cf.studio.kit.<slug>.<type>.v1~`
  is for types that a kit **introduces**; this amends ADR-0068 §8.
- **Registration is not installation.** Node and edge types are registered in the
  types-registry for every type of every built-in kit, as now, the same documents every
  boot. Installing or uninstalling changes an organization's **effective model**, never the
  registry. Edge types are per relation kind (`gts.cf.studio.domainrel.<kind>.v1~`), shared
  by every type that uses the kind, so they stay core.
- **Marks.** A brought type carries `meta.origin = "kit"`, `meta.kit` and
  `meta.kit_version`. The model editor and `domain_model_types` show where it came from.
- **Relations follow their target.** A relation from a core type to a kit type is
  declared by the kit that brings the target. Examples: `project.scopes → work-item` is
  project-issues', and `repository.hosts → pull-request` is project-git's. A kit may add
  relations to Studio's types (ADR-0067 §6). The core never names a kit type.
- **Tabs follow their kit.** Every `shows` relation whose tab a kit contributes moves to
  that kit's overlay, even when its target stays core. For example, `project.artifacts →
  repository-file` is project-artifacts'. The shell keeps only its own tabs: Overview,
  Workspaces, People, Background work, Projects, Attributes, Sources and Kits.
- **Between kits.** A relation from one kit's type to another kit's type stays in the
  source's overlay. While the target's kit is absent it is unresolved and not offered, as
  `Ontology::unresolved_relation_targets` already treats a missing target. It needs no
  declared dependency. Inheritance is different: a type that extends another kit's type
  needs that kit (ADR-0068 open question 2). The only case today, `policy` extends
  `document`, is inside one kit.
- **A section that needs another kit's type.** A screen or section can show a type that
  another kit brings. One example is project-activity's Timeline, which shows
  project-lifecycle's milestones. The section declares the type it needs in its kit's
  manifest, next to the section, as a GTS id:
  `kit_section(..., needs = ["gts.cf.studio.domain.milestone.v1~"])`. The type also appears
  in the kit's `permissions.reads`. The shell mounts the section only where every type it
  needs is installed, and hides it where any is absent or dormant. The kit itself installs
  without the other kit. This is a dependency of one section on one type, not of one kit on
  another, so ADR-0068 open question 2 (declared kit dependencies) is not needed for it.

### 3. A gear's need is a declaration of its own

A gear keeps holding what it holds (ADR-0067 §6: a kit never holds a type). Today a gear's
`ensure_type` (`domain_model/port.rs` 307–340) adds a missing type with
`origin: studio`. After uninstall that would bring the type straight back. So a type now
has up to three declarations, merged in this order:

| Layer | Declares | Present while |
|---|---|---|
| **Gear** | the fields the gear writes, `held_by`, `searchable`, the relations it writes (the `TypeNeed`) | the gear is linked |
| **Kit** | the type's name and description, its descriptive fields, relations, tabs, lifecycle and events | the kit is installed for the organization |
| **Organization** | fields and relations its administrators add | always |

- `ensure_type` records the gear's layer. It no longer adds a whole type as `studio`.
- A gear's layer alone does not make a type visible (§4). It only keeps the gear's writes
  valid and its fields locked (🔒, `held_by`).
- The gear's own data (its tables, its account-management rows, its graph nodes) is the
  gear's. **Uninstalling a kit never touches it.**

### 4. Uninstalling a kit: installed, dormant, absent

After an install, uninstall or upgrade, each type a kit brings is in one of three states
in each organization:

| State | When | Shown | People write | Members read | Administrators read |
|---|---|---|---|---|---|
| **installed** | the kit is installed (base, organization or project kit, ADR-0069 §4) | tabs, generic screens, filters, `domain_model_types` | as the type's rules allow | yes, through the PDP | yes |
| **dormant** | the kit is gone, and the type has objects or a linked gear holds it | only in Admin › Domain model, marked "left by *kit*", and in `domain_model_types?include=dormant` | refused, `failed_precondition` `DOMAIN_TYPE_DORMANT` naming the kit (400; see the note below) | 404 `DOMAIN_TYPE_NOT_INSTALLED` with `kit` | read-only, and may remove it |
| **absent** | the kit is gone, and the type has no objects and no gear holds it | nowhere | 404 | 404 | 404 |

- *Implementation note (2026-11-10, #1033):* the errors catalog keeps `409` for
  concurrency conflicts (`aborted`) and lost creates (`already_exists`); a write
  to a dormant type is the system in the wrong state, so it answers
  `failed_precondition` (`400`) whose violation names the kit and carries
  `DOMAIN_TYPE_DORMANT`. A member's `/query` of a dormant type answers
  `not_found` with the resource `DOMAIN_TYPE_NOT_INSTALLED:<kit>`.
- A dormant type keeps `meta.left_by = {kit, version, at}`. Its objects stay in the graph
  and in the read model as they were. A gear that holds it keeps writing, because the
  gear's sync is not the kit's, and no data is lost (§7, decision 7).
- **Fields and relations a kit added to a core type** go dormant with the kit. Cards,
  forms and filters do not show them, and their values stay in the objects' open payloads.
- **Removing a dormant type** is an administrator's act. It marks the objects deleted and
  drops the type from the organization's model. The graph keeps the `object_type` node,
  which it cannot delete and later re-add (`studio-domain-model.md` §2.2), and a reinstall
  adopts it again.
- **Reinstalling** brings the kit's layer back. The dormant mark goes, and the objects show
  under the same ids, with nothing copied. An **upgrade** applies the difference between
  two overlays under the same rules. A field the new version drops goes dormant if objects
  carry it. A field the organization removed stays removed (§7, decision 6).
- A **base kit** uninstalled by a platform administrator (ADR-0069 §4) applies these rules
  in every organization. The platform removes what it left, in one action (§7,
  decision 8).

### 5. How existing organizations move

The effective model of an organization is computed in layers (#1000), never copied into
the organization's stored model:

```
core seed of the running Studio
  ⊕ the gears' layers (§3)
  ⊕ the base kits' overlays
  ⊕ the organization's kits' overlays (and, in a project, the project's kits' screens)
  ⊕ the organization's own layer: its uploads and edits, as changes
```

- **Core updates reach every organization** (#1002). The core and the kits' overlays are
  read from the running version, not from what was stored at the first edit.
  `add_studio_types` and `ensure_studio_types` go: there is nothing left to copy in.
- **Migration.** On the first touch after the deploy (the `model_sweep.rs` pattern), each
  stored model is split:

  ```
  organization layer = stored model − (core ⊕ gears ⊕ base kits)
  ```

  The split is recorded as a model version, like an import, with no inverse. A revert past
  it is refused with the version named.
- **The equality check.** Before the split is kept, the effective model it yields must
  equal the stored model, compared by entity, field, relation and tab (`meta.origin` marks
  and order are ignored). An organization with every base kit installed, which is every
  organization today, **reads exactly the model it read before**. If the two differ, the
  organization stays on its stored copy, the difference is reported to its administrators
  and in the sweep's log, and nothing changes silently.
- **What an organization changed** survives as its layer:
  - a field added to `risk` is a change over project-lifecycle's `risk`, and it goes
    dormant with it;
  - a type it uploaded that has the id of a kit's type extends that type, as an upload of
    a Studio type does today (§7, decision 9).

### 6. When a type is absent

"Absent" below means absent from the organization's effective model, or dormant and the
caller not an administrator.

**The domain client** (`scripts/gen-domain-client.mjs`):

- It reads the core seed and the built-in kits' overlays, not `ontology.core.json`.
- It writes the core to `shared/src/domain/model.gen.ts` and each kit's types to
  `shared/src/domain/kits/<slug>.gen.ts`. A kit's micro-frontend imports the core and its
  own file. `--check` holds every file.
- A kit's screen mounts only where its kit is installed, so its own types are present when
  it runs.
- **A relation to another kit's type is generated as optional.** The screen asks the
  shell's domain runtime (`model.has(type)`) before it `include`s the relation.

**The query, the object routes and mutate** answer an absent type with **404
`DOMAIN_TYPE_NOT_INSTALLED`**, naming the kit that brings it, instead of today's refusal of an
unknown type or field. A client can then tell "not installed here" from "wrong name".

**The generic screens** (ADR-0067 §7, the shell's list, card, form and history):

- A level shows a tab only for a `shows` relation in the effective model.
- Relation pickers, filters and `include`s leave out absent targets.
- A saved `view` of an absent type says that its type comes with *kit* and offers the
  install to whoever may install it.
- A pin to an absent tab drops, as an unreadable pin does.

**MCP:**

- `domain_model_types` lists the effective model, each type with `origin` (`core`,
  `kit:<slug>`, `gear:<gear>`, `organization`) and `state`.
- `domain_type`, `domain_model_query` and `domain_type_add_field` on an absent type answer
  `DOMAIN_TYPE_NOT_INSTALLED` with the kit, so an agent can call `kits_describe` and
  `kit_organization_install`.
- A kit's own MCP tools (ADR-0068 §2) stay listed. Calling one in an organization
  without the kit answers `KIT_NOT_INSTALLED` with the kit (§7, decision 5).

**Shell code that reads kit types** carries the kit it serves and drops out without it:

- The Inbox source `review-requests` becomes project-specs' `inbox-source`, and
  `pull-requests` becomes project-git's (ADR-0068 phase 4, #1005).
- The project status signals that open Issues, Specs or Activity name their kit. So does
  the "pull requests waited a week" signal, which names project-git.
- The organization Overview's pull-request block and the Tests tab's open pull requests
  need the `pull-request` type, as Timeline needs `milestone` (§2). Without project-git
  they are left out, and the rest of each screen stays.

### 7. Decisions on the first draft's open questions (2026-11-10)

1. **`milestone` goes to project-lifecycle.** Milestones are the plan, and the Timeline
   only shows them. The Timeline section stays in project-activity and declares that it
   needs `milestone` (§2, "A section that needs another kit's type"). Where
   project-lifecycle is not installed, Activity shows without its Timeline.
   `milestone.tracks_2 → work-item` becomes a relation from project-lifecycle to
   project-issues.
2. **`pull-request` goes to a new built-in kit, `project-git`.**
   - **Why the name.** The kit is about a project's work on its Git host: pull requests,
     what waits on whom in them, and later branch protection and merge settings. The name
     says that. A name like `project-reviews` would be confused with project-specs'
     document reviews (`review-request`, `approval`). A name like `project-pull-requests`
     would be too narrow for what the kit will hold.
   - **Levels:** organization and project. Its Inbox source is installed on the
     organization (ADR-0068 §5). It is a base kit by default, so every organization reads
     the same model as today (§5).
   - **What it takes:** `pull-request`, the relation `repository.hosts`, and the
     `pull-requests` Inbox source.
   - **What the core keeps:** repository, branch, commit, repository-file and
     text-content.
   - **`comment` does not go with it.** Comments hang off pull requests, issues and
     documents (`comment.subject_kind`; the artifact sync writes all three). The screen
     that shows them all is Activity. `pull-request.has_comments` becomes a relation from
     project-git to project-activity.
   - **The shell's uses of pull requests** now depend on the kit or degrade (§6; analysis
     §7):
     - the Inbox source moves into the kit;
     - the project status signal names the kit;
     - the organization Overview's pull-request block needs the type;
     - the Tests tab's open pull requests need the type.
3. **`policy` stays in project-specs** until a governance kit exists. That kit will have to
   depend on project-specs, because `policy` extends `document`.
4. **`gears` and the numbered `kit.packages_*` relations are dropped**, not moved:
   `kit.packages_2` … `kit.packages_14`, including `→ gears` and `→ tool`.
   `kit.packages → object-type` and `kit.introduces_type → template` stay. An organization
   whose members created `gears` objects keeps them as a dormant type (§4), left by
   Studio rather than by a kit.
5. **MCP tools stay listed.** The tool list is per connection, not per organization.
   Calling a tool of a kit that is not installed in the caller's organization answers
   `KIT_NOT_INSTALLED`, naming the kit.
6. **The organization's layer is on top.** A field the organization removed from a kit's
   type stays removed when the kit is upgraded. An upgrade changes only the kit's layer.
7. **The sync keeps writing types that nothing shows.** A gear-held type whose kit is
   uninstalled is dormant (§4). The gear goes on writing it, and no data is lost. A
   reinstall finds it current.
8. **The platform removes what a base kit left**, in every organization, in one action: a
   platform administrator's "Remove what *kit* left", run as one `studio-tasks` run across
   the organizations. An organization still removes, on its own, what its own kits left.
9. **An uploaded model that declares a kit's type extends that type** as the
   organization's layer. It does not install the kit. Without the kit, the type is dormant
   or absent like any other.

## Phases

Each phase is one change. It ships alone and leaves the model every organization reads
unchanged until phase 5.

| Phase | Issue | Delivers | Depends on |
|---|---|---|
| 1 | [#1030](https://github.com/constructorfabric/studio-web/issues/1030) | The owner of every seed type as `meta.kit` in `ontology.studio.json`, an annotation with no behaviour. A test: every type has an owner, and no core type relates to a kit type except the crossings the analysis lists. `gen-domain-client.mjs` reads `ontology.studio.json` | — |
| 2 | [#1031](https://github.com/constructorfabric/studio-web/issues/1031) | The gear layer: `ensure_type` records the gear's need as its own layer (§3); the merged model is unchanged | 1 |
| 3 | [#1032](https://github.com/constructorfabric/studio-web/issues/1032) | The layered effective model, and the migration with its equality check (§5) | 2, #1004 (overlay installer), #1000 |
| 4 | [#1033](https://github.com/constructorfabric/studio-web/issues/1033) | Absence: installed / dormant / absent (§4), `DOMAIN_TYPE_NOT_INSTALLED` and `DOMAIN_TYPE_DORMANT`, `KIT_NOT_INSTALLED` for a kit's MCP tools, the MCP fields, the generic screens' rules, sections that need a type (§2), the split generated client (§6), the platform's "Remove what a base kit left" (§7) | 3 |
| 5 | [#1034](https://github.com/constructorfabric/studio-web/issues/1034) | Types move into their kits' overlays, **kits whose screens exist first**, one kit per change: org-reports (`report`); project-tests (`check`); project-issues (`finding`, `work-item`); project-specs (`document`, `policy`, `review-request`, `approval`, the Document types tab); components (`approval-request`); project-team (`assignment`); project-activity (`comment`; Timeline needs `milestone`); then the tab-only kits (project-artifacts, org-connections, project-domain-model, org-costs, org-infrastructure, product-releases), each taking its `shows` relations | 4 |
| 6 | [#1035](https://github.com/constructorfabric/studio-web/issues/1035) | project-lifecycle's `risk`, `dependency`, `lifecycle-stage` and `milestone` join the overlay that #1004 gives project-lifecycle first | 4, #1004 |
| 7 | [#1036](https://github.com/constructorfabric/studio-web/issues/1036) | The `project-git` built-in kit: `pull-request`, `repository.hosts`, the `pull-requests` Inbox source; the project status signal, the organization Overview's pull-request block and the Tests tab's open pull requests depend on it or degrade | 4, #1005 |
| 8 | [#1037](https://github.com/constructorfabric/studio-web/issues/1037) | The `assistant` built-in kit, with `model`, `tool` and `message` | 4 |
| 9 | [#1038](https://github.com/constructorfabric/studio-web/issues/1038) | `gears` and the numbered `kit.packages_*` relations leave the seed; existing `gears` objects go dormant | 4 |
| 10 | [#1039](https://github.com/constructorfabric/studio-web/issues/1039) | The Inbox's `review-requests` source and the remaining status signals carry their kit (§6) | 5, #1005 |

## Consequences

- Good, because an organization's model says what it uses. Without Tests there is no
  `check` type, no Tests tab and no generated `check` client in other kits' screens.
- Good, because a Studio upgrade reaches every organization. The core and the kits are no
  longer frozen at an organization's first edit (#1002).
- Good, because nothing stored moves. The ids stay, and a reinstall shows the objects
  again.
- Bad, because the effective model is now computed from five layers on every model read.
  It is cached per organization per model head, as the stored model is today, and every
  install, uninstall, upgrade and deploy invalidates it.
- Bad, because a gear can hold data that no installed screen shows (a dormant held type).
  The data is the gear's, and it is visible to administrators, but it costs storage and
  sync time.
- Bad, because the core is 43 types, not a handful. Most of it is vocabulary nothing
  writes yet. Moving it later is cheap once phases 1–4 exist, so the count is not
  defended here.

## Confirmation

- An organization with only the base kits reads, after phase 3, the same types, fields,
  relations and tabs as before the migration. The test compares the effective model with
  the stored one for a seeded organization and for one with an uploaded model and added
  fields.
- Uninstalling org-reports in an organization with `report` objects:
  - leaves `report` dormant;
  - the Reports tab goes;
  - a member's `domain_model_query` on `report` answers `DOMAIN_TYPE_NOT_INSTALLED` with
    `org-reports`;
  - an administrator reads the objects.

  Reinstalling shows the same objects under the same ids.
- Uninstalling project-tests in an organization with no `check` objects leaves `check`
  absent.
- A gear-held type stays dormant, not absent, while its gear is linked. The gear's next
  `ensure_type` does not bring it back as installed.
- No core type in `ontology.studio.json` declares a relation to a kit's type (the phase 1
  test).
- `gen-domain-client.mjs --check` passes with the core and per-kit files, and no kit's
  generated file names another kit's type as a required relation.
- Without project-lifecycle, a project's Activity tab shows and its Timeline section does
  not. Without project-git, the Inbox has no pull-request items, the project status and
  the organization Overview leave pull requests out, and the Tests tab shows its CI runs
  without the open pull requests.
- An upgrade of a kit does not bring back a field the organization removed from one of
  its types.

## Open questions

The first draft's nine questions were settled on 2026-11-10 (§7). None remain open in
this record. The governance kit that would take `policy` (§7, decision 3), and declared
dependencies between kits (ADR-0068 open question 2), are left to the records that
introduce them.

## More Information

- The analysis, one row per type with citations: [the domain model split](../design/domain-model-split.md).
- The seed: `studio-backend/src/domain_model/ontology.studio.json`; loading and
  `add_studio_types`: `ontology.rs`; `prepare_model` and `ensure_studio_types`:
  `service.rs`; `ensure_type`: `port.rs`.
- The built-in kits: `studio-backend/src/kit_registry/service.rs` `builtin_catalogue()`,
  `contents.rs`; the portal's kit sections: `studio-frontend-prototype/src-app/mfe_packages/*/mfe.json`.
- The domain client: `scripts/gen-domain-client.mjs`.
- Issues: #1025 (this), #1000 (layered model), #1002 (core updates), #1004 (overlay
  installer), #1005 (inbox sources from kits), all part of #998.
