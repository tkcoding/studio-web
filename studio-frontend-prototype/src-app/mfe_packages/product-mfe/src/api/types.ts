/**
 * The wire shapes Project › Product and Project › Components read, copied
 * unchanged from the prototype's client (src/api.ts at 00828880) so the models
 * ported with them keep their types: studio-product (the product record,
 * product.gdl, Gearbox), studio-environments (targets, infra services,
 * deployments, images), studio-components-catalog (the catalogue, the
 * registry, a project's components), studio-spec-mapping and studio-documents.
 */

/** One screen of a micro-frontend as a build of the shell rendered it. */
export interface ScreenPreview {
  component: string;
  version: string | null;
  commit: string;
  route: string;
  label: string | null;
  order: number;
  /** `data:image/webp;base64,...` */
  image: string;
  width: number | null;
  height: number | null;
  captured_at: string;
}

/* ── studio-tasks / studio-scheduler ── */

export type RunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** One unit of background work. `GET /studio-tasks/v1/runs`. */
export interface TaskRun {
  id: string;
  tenant_id: string;
  /** `<gear>.<verb>` — `connector.graph_sync`, `notify.deliver`. */
  task_type: string;
  /** `queued` | `running` | `succeeded` | `failed` | `cancelled`. */
  state: string;
  /** What the handler was given. Shape belongs to the task type. */
  payload: Record<string, unknown>;
  /** What the run was told not to overtake, when ordering was asked for. */
  partition_key?: string | null;
  attempts: number;
  /** The phase the handler last reported; kept after it ends. */
  progress?: string | null;
  /** One line about what it did, once it succeeded. */
  summary?: string | null;
  /** The handler's structured result, where it has one. */
  result?: Record<string, unknown> | null;
  last_error?: string | null;
  cancel_requested: boolean;
  requested_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

/** Spec against code for one project (`POST /conformance`). */
export interface Conformance {
  repo: string;
  components_in_code: string[];
  items: {
    capability: string;
    status: "implemented" | "missing";
    implemented_by: { name: string; declared: boolean }[];
    candidates: string[];
  }[];
  total: number;
  unexplained: { name: string; declares: string[] }[];
  gearbox: ProductChange[];
}

/** One catalogue source, as the sync takes it and the server keeps it. */
export interface CatalogRepoSource {
  tenant: string;
  connection_id: string | null;
  repo: string;
  git_ref: string | null;
  mode: string;
  /** In an answer: the platform's catalogue already reads this repository in
   *  this mode (ADR-0042), so the organization's copy can be removed. */
  shadowed_by_platform?: boolean | null;
}

/** Where a registry entry was found. */
export interface RegistryOccurrence {
  project_id?: string | null;
  project_name?: string | null;
  repo: string;
  git_ref?: string | null;
  path: string;
  commit?: string | null;
  /** `gear.toml`, `gear.gdl`, `attribute`, `package` or `kit`; `detected`
   *  where a candidate detector found it and nothing declares it. */
  declared_in: string;
  /** `project`, or `organization` for the organization's gear repository
   *  (ADR-0042): then `project_id` is null and `project_name` is the
   *  organization's. Absent from a server older than it. */
  scope?: "project" | "organization" | string;
}

/** Who answers for a registry entry. */
export interface RegistryOwner {
  kind: "person" | "team";
  /** The person's Studio id, or the team's key, when known. */
  id?: string | null;
  name: string;
}

/** One decision a person made about a registry entry (ADR-0041 P2). */
export interface RegistryDecision {
  /** `register`, `reject`, `deprecate`, `restore`, `publish`, `mark_published`,
   *  `merge` or `edit`; also `declare` and `published` (by `platform-sync`). */
  action: string;
  from: string;
  to: string;
  /** The person's Studio id, else the token's subject. */
  by: string;
  by_name?: string | null;
  at: string;
  reason?: string | null;
  /** The fields it set: `owner`, `replaced_by`, `merge_into`, `version`, `merged_from`, … */
  details?: Record<string, unknown> | null;
}

/** What a `publish` would write into the platform's gear repository: the
 *  answer of a dry run. */
export interface RegistryPublishPreview {
  /** The platform's gear repository, `owner/name`. */
  repo: string;
  /** The branch the pull request goes back to. */
  base_branch: string;
  /** `contribute/<organization>/<name>`. */
  branch: string;
  /** Where the gear's files go there. */
  path: string;
  files: string[];
  /** Not copied (not text), relative to the gear's directory. */
  skipped: string[];
  title: string;
  /** The platform's gear repository it goes into, by source id; absent while
   *  the platform names its repository by a catalogue source. */
  source_id?: string | null;
  /** Every platform gear repository it could go into, with how many gears of
   *  its category each holds (ADR-0046 phase 4). */
  targets?: { source_id: string; repo: string; gears_in_category: number }[];
}

/** One component of the organization's registry (ADR-0041). */
export interface RegistryEntry {
  name: string;
  kind: string;
  /** `candidate`, `declared`, `registered`, `published`, `rejected`, `deprecated` or `merged`. */
  state: string;
  description?: string | null;
  category?: string | null;
  owner?: RegistryOwner | null;
  capabilities: string[];
  /** Names merged into this entry. */
  aliases?: string[];
  /** For a `merged` entry, the entry it was folded into. */
  merged_into?: string | null;
  /** For a `deprecated` entry, the entry to use instead. */
  replaced_by?: string | null;
  /** For a `published` entry, the platform's version of it when known. */
  version?: string | null;
  /** The pull request that gave it to the platform (ADR-0042 §4); the entry
   *  stays `registered` until the platform's catalogue has it. */
  contribution?: RegistryContribution | null;
  /** Extract (ADR-0044 §1): the two pull requests that move it into the
   *  organization's gear repository; `completed_at` once both were merged
   *  and the version tagged (the entry is then `extracted`). */
  extraction?: RegistryExtraction | null;
  /** The projects that use it without declaring it (ADR-0041 P4). */
  consumers?: RegistryConsumer[];
  /** What a model last proposed for it; never a state change. */
  suggestion?: RegistrySuggestion | null;
  /** Only on the single-entry read and a decision's answer, newest first. */
  decisions?: RegistryDecision[] | null;
  /** No repository declares it any more; kept because it was the organization's. */
  orphaned: boolean;
  first_seen?: string | null;
  last_seen?: string | null;
  /** For a `candidate`: the sum of its evidence's weights (P3). */
  score?: number | null;
  /** For a `candidate`: why it looks like a gear, signal by signal. */
  evidence?: RegistryEvidence[];
  occurrences: RegistryOccurrence[];
  /** What a `publish` with `dry_run` would write; absent otherwise. */
  publish_preview?: RegistryPublishPreview | null;
  /** What an `extract` with `dry_run: true` would write. */
  extract_preview?: RegistryExtractPreview | null;
}

/** A gear given to the platform: the pull request into its gear repository. */
/** A gear leaving its project for the organization's gear repository
 *  (ADR-0044 §1). */
export interface RegistryExtraction {
  crate_name: string;
  version: string;
  /** `<gear>/v<version>`, made once both pull requests are merged. */
  tag: string;
  gear_repo: string;
  gear_path: string;
  gear_pr_url?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  source_repo: string;
  source_path: string;
  source_pr_url?: string | null;
  at: string;
  by: string;
  by_name?: string | null;
  completed_at?: string | null;
  tagged_commit?: string | null;
}

/** What Extract would write: an `extract` with `dry_run: true`. */
export interface RegistryExtractPreview {
  crate_name: string;
  version: string;
  tag: string;
  gear_repo: string;
  gear_base: string;
  gear_path: string;
  gear_files: string[];
  source_repo: string;
  source_base: string;
  source_files: string[];
  source_deleted: string[];
  /** `extract/<name>`, in both. */
  branch: string;
  skipped: string[];
  /** The new crate's `Cargo.toml`, as written. */
  manifest?: string | null;
}

export interface RegistryContribution {
  repo: string;
  /** `contribute/<organization>/<name>`. */
  branch: string;
  pr_url?: string | null;
  /** Where the files went in the platform's repository. */
  path: string;
  files: number;
  at: string;
  by: string;
  by_name?: string | null;
}

/** A project that uses a registry entry it does not declare. */
export interface RegistryConsumer {
  project_id: string;
  project_name: string;
  /** `cargo`, `product`, or both. */
  via: string[];
}

/** What `POST /registry/{name}/suggest` proposed. */
export interface RegistrySuggestion {
  description?: string | null;
  category?: string | null;
  /** Keys of the organization's capability vocabulary only. */
  capabilities: string[];
  at: string;
  /** `provider:model`. */
  model: string;
}

/** One signal a candidate detector found (ADR-0041 P3). */
export interface RegistryEvidence {
  /** `rest`, `persistence`, `types`, `boundary`, `docs`, `consumers` or `copied`. */
  signal: string;
  /** "own REST surface: rest.rs", "used by 3 modules", "copied in insight". */
  detail: string;
  weight: number;
}

/** A capability a project's documents declare, and the documents that do. */
export interface DeclaredCapability {
  key: string;
  sources: {
    kind: "document" | "file";
    id: string;
    label: string;
    /** What the document is now: a Studio document's `updated_at`, a file's
     *  `content_sha`. A decision taken against another one needs review. */
    revision?: string;
    /** The artifact node of a bound file. */
    node_id?: string | null;
    /** Implied by the document's functional requirements, not declared in
     *  its front matter. */
    inferred?: boolean;
    /** For an inferred capability, the requirements that imply it. */
    because?: string[];
    /** For an inferred capability, the capability's words those requirements
     *  use. Empty until a document indexed before this was kept is read again. */
    terms?: string[];
    /** For an inferred capability, how many requirements mention it; `because`
     *  lists the first few. */
    requirements?: number;
    /** `false` for a repository file nobody has confirmed on the Specs tab. */
    confirmed?: boolean;
  }[];
}

/** One non-functional statement a project's document makes. */
export interface DeclaredRequirement {
  text: string;
  source: DeclaredCapability["sources"][number];
}

/** The deployment profile the project's non-functional statements point to. */
export interface ProfileAdvice {
  /** `dev`, `local` or `prod`, as Studio's `product.gdl` names them. */
  profile: string;
  /** `embedded`, `self_hosted` or `kubernetes`. */
  kind: string;
  because: string[];
}

/** What the project is for, chosen at creation:
 *  - `new_gears`  — build new gears (repo: create new, or an existing gear store);
 *  - `product`    — assemble a product from gears (repo: always a new one);
 *  - `existing`   — import a gears-based app already built (repo: its existing one). */
export type ProjectKind = "new_gears" | "product" | "existing";

/** The project attributes carried in PROJECT_CONFIG_TYPE metadata. */
export interface ProjectConfig {
  mode?: ProjectMode;
  kind?: ProjectKind;
  /** The key of the project type it was created as (`project-types.ts`);
   *  `kind` stays the recipe that created it. */
  type?: string;
  /** Read by nothing since ADR-0058: the stages are a computed status. Kept
   *  so a config that carries it round-trips unchanged. */
  stages?: string[];
  status?: ProjectStatus;
  /** Seed source: a git url, a brief, or an uploaded file id. */
  source_git_url?: string;
  brief?: string;
  /** The project's repositories: the one record of them (`project-sources.ts`). */
  sources?: import("../model/project-sources").ProjectSource[];
  /** The CI workflow that builds the product (ADR-0045): Build starts it. */
  build?: { repo: string; workflow: string };
  /** The product's frontend as projects recorded it before the product kept
   *  it (`ProjectProduct.frontend`): the micro-frontends its shell mounts, by
   *  package name, and the shell as FrontX's provenance spells a source
   *  (`github:owner/repo//template-shell@ref`). Read when the product has
   *  none; the Frontend section writes the product's. */
  frontend?: { mfes?: string[]; shell?: string };
  /** The icon somebody chose (`tenant-icon.ts`); absent: the kind's. */
  icon?: unknown; // the prototype's tenant-icon TenantIcon: not read here
  /** What the product is, as a member confirmed it after Studio proposed it
   *  from the specs (`product-kind.ts`); absent: not decided yet. */
  product_kind?: import("../model/product-kind").ProductKindChoice;
}

/** Where a FrontX package is: `owner/name`, its directory there, the ref it is
 *  taken at (`main` when absent), and its npm name as the catalogue knows it. */
export interface FrontxPlace {
  repo: string;
  path: string;
  ref?: string;
  package?: string;
}

/** A product's FrontX frontend (ADR-0050), as the product keeps it and
 *  product.gdl says it: `frontend = frontx_product(...)` (GDL 1.5). */
export interface FrontendPick {
  shell: FrontxPlace;
  /** Each with the product's gears its screens call, by engine id. */
  mfes: (FrontxPlace & { requires?: string[] })[];
  /** Packages the micro-frontends share that the shell does not have. */
  libraries?: FrontxPlace[];
}

/** The two creation shapes. A greenfield project has no source to import; a
 *  modernization has exactly one. Carried in a project's config metadata. */
export type ProjectMode = "greenfield" | "modernize";

/** Forward-only: draft -> active -> archived, and archived is terminal. */
export type ProjectStatus = "draft" | "active" | "archived";

/** One journey stage, as the catalogue serves it.
 *
 *  This used to be a hardcoded array here, left behind when the studio-project
 *  gear was retired and `GET /studio-project/v1/stages` went with it. It is the
 *  path a product takes through the studio, so an organization has to be able
 *  to change it — which a constant in a client cannot express. ADR-0014
 *  section 7 moved the catalogue back to the server; `api.stages()` reads it.
 *
 *  What comes back is already the EFFECTIVE list for that workspace: the
 *  platform catalogue, overlaid by the organization, overlaid by the workspace,
 *  with hidden entries removed and the whole thing in catalogue order. A client
 *  must not re-sort it or assume `intent` is present — a workspace may have
 *  replaced it. */
/** One capability a product may need, and the words that find components
 *  providing it.
 *
 *  Was `CAP_KEYWORDS` in documents.tsx — a table in a UI file that decided
 *  which components a workspace could be offered. It is catalogue data now,
 *  overlaid the same three ways as everything else. */
/** What the catalogue can say about whether a component was ever built.
 *
 *  `"unknown"` is not a maybe — it means the question does not apply or was
 *  never asked. A FrontX package carries no crate count at all, and a component
 *  with no profile has not been scanned. Neither is evidence of absence. */
export type BuildState = "built" | "docs-only" | "unknown";

/** What the Gearbox engine said about a component, as the catalogue sync
 *  recorded it: it can go into a product (`runs`), it is described but cannot
 *  run from this corpus (`blocked`), or nothing describes it for composition
 *  (`undescribed`). A different question from `built`. */
export type Composability = "runs" | "blocked" | "undescribed";

/** One component offered for one capability. */
export interface Candidate {
  name: string;
  kind: string;
  /** Which step proposed it: `contract` (the engine reports the gear provides
   *  one of the capability's contracts) or `evidence` (its words were found in
   *  what the gear says about itself). Every `contract` comes first. */
  step?: "contract" | "evidence";
  /** The provided contracts that satisfy the capability (`contract` only). */
  contracts?: string[];
  /** The text around the first term found (`evidence` only). */
  passage?: string | null;
  /** The document the passage is quoted from, when it came from the gear's
   *  own documentation rather than the catalogue's text. */
  cites?: string | null;
  /** The version the catalogue knows the component at, recorded with a decision. */
  version?: string | null;
  /** A member's earlier decision on this gear for this capability. */
  decision?: { decision: "confirmed" | "rejected"; needs_review: boolean } | null;
  /** The gear declares this capability itself (gear.toml, or its catalogue
   *  page) -- a statement, not a match on the words it uses. */
  declared?: boolean;
  /** How many of the capability's terms this component mentions. */
  score: number;
  /** Which terms they were, so a suggestion can be argued with. */
  why: string[];
  built: BuildState;
  composable: Composability;
  /** The engine's reason, when `blocked`. */
  composable_why?: string | null;
  /** `project` when the project's own repository declares this gear (whether
   *  or not the catalogue lists it too); `organization` for a gear the
   *  organization's registry holds from another project or its gear
   *  repository; `catalogue` otherwise. */
  origin?: "catalogue" | "project" | "organization";
  /** For a `project` gear, where it lives in the repository; for an
   *  `organization` one, which project and where (`Insight: src/analytics`). */
  path?: string | null;
  /** For a gear the organization's registry backs, its state there. */
  registry_state?: string | null;
  /** For a `deprecated` registry gear, the entry to use instead. */
  replaced_by?: string | null;
  /** Whose component it is (ADR-0042): the shared set, the organization's
   *  own, or this project's. Absent from a server older than the tiers. */
  tier?: ComponentTier;
  /** Its gear.gdl maturity (design | experimental | preview | stable |
   *  deprecated). Absent when unknown, or from an older server. */
  maturity?: string | null;
}

/** Where a component comes from (ADR-0042): `platform` -- the shared set,
 *  synced once for every organization; `organization` -- the organization's
 *  own catalogue and registry; `project` -- declared in this project's own
 *  repositories. */
export type ComponentTier = "platform" | "organization" | "project";

/** One capability, and what could fill it. */
export interface PlanRow {
  capability: string;
  candidates: Candidate[];
  /** No candidate at all — the capability has nothing to build from. */
  gap: boolean;
  /** Candidates exist, but none of them has been built. */
  unbuilt: boolean;
  /** Answered by the deployment profile, not by gears: no candidates, not a gap. */
  nonfunctional?: boolean;
  /** The documents that need it, when the plan was read for a project. */
  sources?: DeclaredCapability["sources"];
  /** The capability's name in the vocabulary (project plans only). */
  label?: string | null;
  /** The words a gear is looked for with; empty means the key itself. */
  terms?: string[];
  /** The contracts that satisfy it. */
  contracts?: string[];
  /** Every component that fills it, past the shortlist in `candidates`:
   *  what the product's picks are checked against. Rejected gears are left
   *  out. `strong`: a contract, a declaration or a member's confirmation;
   *  otherwise only its words were found. */
  providers?: { name: string; strong: boolean }[];
}

export interface Capability {
  key: string;
  label: string;
  /** Empty means "match the key itself". */
  terms: string[];
  /** What the Gearbox engine can report a gear as providing, any of which
   *  satisfies the capability. Matched before `terms`. */
  contracts?: string[];
  /** Answered by where and how the product runs, not by gears. */
  nonfunctional?: boolean;
  owner: string;
  owner_tenant_id?: string | null;
}

export type RepoSource = "local" | "git" | "github" | "gitlab";

/** One workspace source — mirrored into .cf-workspace.toml by the backend. */
export interface RepoEntry {
  /** Directory name under the workspace root: [a-z0-9_-]+ */
  name: string;
  /** UI-level source flavor; github/gitlab are git with a composed URL. */
  source: RepoSource;
  url?: string;
  path?: string;
  /** Mount/clone target relative to the workspace root (defaults to name). */
  target?: string;
  branch?: string;
  /** credstore secret reference holding the repo PAT (private repos). */
  token_ref?: string;
  /** A project source's `share_mode` (`project-sources.ts`), shown on its
   *  row; never sent with a session — the IDE reads it from the config. */
  share_mode?: "branch" | "pull_request";
}

export interface Connection {
  id: string;
  /** Tenant holding this connection: the viewed one, or an ancestor when inherited. */
  owner_tenant_id: string;
  provider: string;
  label: string;
  /** Account the credential belongs to, captured when it was verified. */
  account: string;
  base_url: string;
  /** personal | workspace | organization */
  scope: string;
  /** credstore reference of the token — pass as token_ref when launching a session.
   *  Empty for a connection stored without one (a public gear repository). */
  secret_ref: string;
  created_at_epoch_secs: number;
  /** The provider's options: a gear repository's `ref` and `source_id`. */
  options?: Record<string, string>;
  /** Whether the caller created it: a person's own connections are listed on
   *  their profile, a tenant's shared ones on the tenant. */
  mine?: boolean;
}

/** One place an organization's products run: a cluster reached through a
 *  `kubernetes` connection, a registry, a namespace per project. */
/** What runs an environment's products: a cluster, or Constructor Research (ADR-0049). */
export type EnvironmentKind = "kubernetes" | "research";

export interface DeployEnvironment {
  id: string;
  name: string;
  description: string;
  /** Absent on environments written before kinds: a cluster. */
  kind?: EnvironmentKind;
  /** The organization's `kubernetes` connection, or its `research` one. */
  connection_id: string;
  /** For `research`: the Research project products run in, and the hardware. */
  research_project?: string | null;
  research_hardware?: string | null;
  /** Image registry prefix (`ghcr.io/acme`); empty: images as generated. */
  registry: string;
  /** The organization's `registry` connection: the cluster pulls with it and
   *  a published chart is fetched with it (ADR-0048). */
  registry_connection_id?: string | null;
  /** `{project}-{environment}` by default. */
  namespace_pattern: string;
  /** `namespace`: a Postgres of the product's own in its namespace (ADR-0048). */
  database: "none" | "shared" | "namespace";
  /** The image of a `namespace` database; absent: pgvector/pgvector:pg18. */
  database_image?: string | null;
  /** A deploy waits for an organization administrator's approval. */
  protected: boolean;
  /** How strictly a product is checked for it (ADR-0060): `dev` checks the
   *  profile as a development one; absent from an older backend. */
  strictness?: "dev" | "prod";
  /** The environment a release must have succeeded in first. */
  promote_from?: string | null;
  /** The projects that may deploy here; absent: all of them. */
  projects?: string[] | null;
  /** The project that keeps it (ADR-0054); absent: the organization's. */
  project_id?: string | null;
  /** Whether projects may preview a build here (ADR-0055); absent: no. */
  previews?: PreviewSettings | null;
  /** The build Job's image, from the organization's own mirror and pinned by
   *  digest (`image@sha256:…`); absent: the one Studio ships with. */
  builder_image?: string | null;
  /** The registry connection the cluster pulls the builder image with. */
  builder_registry_connection_id?: string | null;
  /** A read-only registry identity the cluster pulls the product with; absent:
   *  it gets the push connection's credential, which can write. */
  registry_pull_connection_id?: string | null;
  /** Where a build runs: a pattern, `{project}-build` by default. */
  build_namespace?: string | null;
  /** The namespaces the cluster gives, when Studio may not create its own. */
  namespaces?: string[] | null;
  /** The registry token a build gets may reach past the project's own path. */
  allow_broad_registry_token?: boolean | null;
  /** Where a product's infra services run here (ADR-0064); absent: with the product. */
  infra?: InfraPlacement | null;
  /** What the server thinks is risky about how it is set up, one sentence each. */
  warnings?: string[];
  /** The code of each of `warnings`, in order: `PULL_USES_PUSH_LOGIN` while
   *  the cluster pulls with the push login. Absent from an older backend. */
  warning_codes?: string[];
  updated_by: string;
  updated_at: string;
}

/** Whether an environment's cluster is ready for Studio (`GET …/readiness`). */
export type ReadinessLevel = "bootstrapped" | "namespace_limited" | "partial" | "unreachable";

export interface EnvironmentReadiness {
  level: ReadinessLevel;
  /** What the bootstrap would have given and the cluster does not. */
  missing: string[];
  /** The namespaces Studio may use there. */
  namespaces: string[];
  bootstrap_version?: string | null;
  /** The cluster enforces Studio's policy on what runs in its namespaces. */
  policy_enforced: boolean;
  detail?: string | null;
  /** What the environment's own setup should fix, though the cluster is ready. */
  warnings?: string[];
  /** The code of each of `warnings` (`PULL_USES_PUSH_LOGIN`). */
  warning_codes?: string[];
}

/** What an environment says of previews (ADR-0055). */
export interface PreviewSettings {
  /** Wildcard DNS to the cluster's ingress: a preview answers at
   *  `<namespace>.<domain>`. Empty: no address. */
  domain: string;
  /** Absent: the cluster's default Ingress class. */
  ingress_class?: string | null;
  /** How long a preview lives, and the most anybody may ask for. */
  ttl_hours?: number | null;
  /** How many previews one project keeps there at once. */
  max_live?: number | null;
}

/** A deployment that is a preview (ADR-0055). */
export interface DeploymentPreview {
  name: string;
  expires_at: string;
  host?: string | null;
  removed_at?: string | null;
  removal_error?: string | null;
}

/** What an administrator sends for an environment. */
export interface DeployEnvironmentInput {
  name: string;
  description: string;
  kind?: EnvironmentKind;
  connection_id: string;
  research_project?: string | null;
  research_hardware?: string | null;
  registry: string;
  registry_connection_id?: string | null;
  namespace_pattern?: string;
  database: "none" | "shared" | "namespace";
  database_image?: string | null;
  protected: boolean;
  promote_from?: string | null;
  projects?: string[] | null;
  previews?: PreviewSettings | null;
  builder_image?: string | null;
  builder_registry_connection_id?: string | null;
  registry_pull_connection_id?: string | null;
  build_namespace?: string | null;
  namespaces?: string[] | null;
  allow_broad_registry_token?: boolean | null;
  /** Where a product's infra services run (ADR-0064); absent: with the product. */
  infra?: InfraPlacement | null;
  /** How strictly a product is checked for it (ADR-0060 §5); absent: `prod`
   *  when protected, else `dev`. */
  strictness?: "dev" | "prod" | null;
}

/** Where an environment runs a product's infra services (ADR-0064 §3). */
export interface InfraPlacement {
  /** `with_product`: in the product's namespace, one of each per environment
   *  (always so in a dev environment). `shared`: the organization's place. */
  placement: "with_product" | "shared";
  shared: InfraSharedService[];
  /** The Ingress a generated chart routes a service's `public_url` with. */
  ingress?: InfraIngress | null;
}

/** How a service placed with the product is reached at its `public_url`. */
export interface InfraIngress {
  /** `ingressClassName`; absent: the environment's preview class. */
  class?: string | null;
  /** The TLS secret of an `https://` address. */
  tls_secret?: string | null;
  annotations?: Record<string, string>;
}

/** One service the organization runs for every product of an environment. */
export interface InfraSharedService {
  service: string;
  namespace?: string | null;
  /** Capability -> its value (`oidc.issuer` -> the issuer). Not secret. */
  provides: Record<string, string>;
}

/** An infra service's passport, from its `service.gdl` (`kind = "infra"`). */
export interface InfraPassport {
  name: string;
  version?: string | null;
  description?: string | null;
  /** The image as its publisher names it. */
  image?: string | null;
  ports: Record<string, number>;
  health?: string | null;
  args: string[];
  config: Record<string, string>;
  secrets: string[];
  /** Capability -> template of its value. */
  provides: Record<string, string>;
  stateful: boolean;
  storage?: string | null;
  data_path?: string | null;
  chart?: string | null;
  chart_version?: string | null;
}

/** One infra service of a project's product (ADR-0064). */
export interface InfraService {
  passport: InfraPassport;
  /** Imported into the project's path, by digest. */
  image?: string | null;
  /** A ready chart under the project's path; absent: generated from the passport. */
  chart_ref?: string | null;
  chart_version?: string | null;
  chart_values?: Record<string, unknown> | null;
  /** Where people reach it: `{public_url}`. Placed with the product, its
   *  generated chart routes it with an Ingress. */
  public_url?: string | null;
  /** Files its container reads, by absolute path; text with the same
   *  template names as `provides` (`{secret.KEY}`, `{public_url}`). Mounted
   *  read-only by a generated chart. */
  files?: Record<string, string>;
  /** Arguments after the passport's (`--import-realm`). */
  args?: string[];
}

/** One `use_service(...)` call of a product's `infra`, as the server reads product.gdl. */
export interface UseServiceCall {
  name: string;
  source: string;
  image?: string | null;
  chart?: string | null;
  chart_version?: string | null;
  config: Record<string, string>;
  profile_config?: string | null;
}

/** `GET`/`PUT /studio-product/v1/product-infra`: the infra services as the description says them. */
export interface ProductInfra {
  items: InfraService[];
  /** `product-description`, or `project-list` for a project with no description yet. */
  source: 'project-list' | 'product-description';
  /** The description revision the list was read from; a save is made against it. */
  revision: number | null;
  services: UseServiceCall[];
}

/** `POST /studio-product/v1/product-description-outlines`: what a product.gdl says. */
export interface DescriptionOutline {
  revision?: number | null;
  infra?: UseServiceCall[] | null;
  /** Absent when the product has no literal `profiles` list. */
  profiles?: { id: string; kind: string }[] | null;
  home_source?: string | null;
  /** Each part of the product (`gear:<key>`, `mfe:<path>`, `shell`, `infra:postgres`) and its lines. */
  nodes: { id: string; lines: number[] }[];
  /** Each line with the parts it says, the first the one it is. */
  lines: { line: number; nodes: string[] }[];
}

/** `GET`/`PUT /studio-product/v1/product-kind`: what the product is. */
export interface ProductKindAnswer {
  proposed: import('../model/product-kind').ProductKind;
  reasons: string[];
  basis: 'specs' | 'sources' | 'none';
  alternatives: import('../model/product-kind').ProductKind[];
  choice?: import('../model/product-kind').ProductKindChoice | null;
  decided: boolean;
  status: string;
  kinds: { id: import('../model/product-kind').ProductKind; title: string; what: string; builds: string }[];
  experimental: boolean;
}

/** What a deploy does with one infra service. */
export interface InfraPlanItem {
  service: string;
  placement: "with_product" | "shared";
  install: "database" | "chart" | "generated" | "shared";
  image?: string | null;
  chart?: string | null;
  provides: { capability: string; variable: string }[];
  refusal_code?: string | null;
  refusal?: string | null;
  /** The address its generated chart routes to it with an Ingress. */
  route?: string | null;
  /** What the deploy does not apply of what the project says of it. */
  notes?: string[];
}

/** What a deploy of the project to one environment does with its infra services. */
export interface InfraPlan {
  environment_id: string;
  environment_name: string;
  placement: "with_product" | "shared";
  namespace: string;
  items: InfraPlanItem[];
}

/** Where a recorded image runs now. */
export interface ImageRunning {
  environment_id: string;
  environment_name: string;
  deployment_id: string;
  namespace: string;
  deployed_at: string;
}

export type ImageKind = "image" | "chart";

export type ImageState = "present" | "missing" | "deleted" | "retained";

/** An image or chart the project put in a registry, as Studio recorded it. */
export interface ProjectImage {
  id: string;
  project_id: string;
  registry_connection_id?: string | null;
  registry_host: string;
  repository: string;
  /** What a deploy names it by: `host/repository@digest` or `:tag`. */
  reference: string;
  tags: string[];
  digest: string;
  media_type?: string | null;
  size_bytes?: number | null;
  platforms: string[];
  build_id?: string | null;
  app?: string | null;
  commit?: string | null;
  description_revision?: number | null;
  lock_hash?: string | null;
  pushed_by?: string | null;
  pushed_at: string;
  kind: ImageKind;
  state: ImageState;
  /** Kept whatever the retention says. */
  pinned: boolean;
  /** The image it was copied from, when it was promoted. */
  promoted_from?: string | null;
  /** The external reference it was imported from. */
  source_ref?: string | null;
  running_in: ImageRunning[];
}

/** An environment of the project and the product profile it runs there
 *  (ADR-0057): each environment bound at most once, a profile to any number. */
export interface EnvironmentBinding {
  profile: string;
  environment_id: string;
  /** Chart values the release gets there, under what a deploy sets. */
  values?: Record<string, unknown> | null;
}

/** A secret of a project's configuration in an environment: the key only. */
export interface ConfigSecret {
  environment_id: string;
  key: string;
}

/** Where a project's product can be deployed. */
export interface ProjectTargets {
  organization_id: string;
  project_name: string;
  environments: { environment: DeployEnvironment; namespace: string }[];
  bindings: EnvironmentBinding[];
  /** The secret keys of its configuration, per environment. */
  secrets?: ConfigSecret[];
}

export type DeploymentState =
  | "awaiting_approval"
  | "declined"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** One deploy: asked for, decided, run -- the record of what runs where. */
export interface Deployment {
  id: string;
  project_id: string;
  project_name: string;
  environment_id: string;
  environment_name: string;
  profile: string;
  product: string;
  /** `install` | `uninstall`; absent on records from before uninstall. */
  action?: "install" | "uninstall";
  /** The earlier deployment this one installs again. */
  redeploy_of?: string | null;
  commit?: string | null;
  lock_hash?: string | null;
  /** The build it came from. */
  build?: string | null;
  images: { app: string; image: string }[];
  namespace: string;
  chart_sha256: string;
  /** The published chart it installs (ADR-0048). */
  chart_ref?: string | null;
  chart_version?: string | null;
  state: DeploymentState;
  run_id?: string | null;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  decided_by?: string | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  reason?: string | null;
  outcome?: string | null;
  /** A preview (ADR-0055); absent for a deploy of what runs there. */
  preview?: DeploymentPreview | null;
}

export interface RemoteRepo {
  id: string;
  name: string;
  full_path: string;
  clone_url: string;
  default_branch?: string;
  description?: string;
  visibility?: string;
}

/** One ingested artifact node from `GET /studio-artifact-ingest/v1/nodes`.
 * `value` is the free-form GTS payload (issue/PR/repo fields). */
export interface ArtifactNode {
  type_id: string;
  instance_id: string;
  value: {
    repo?: string;
    external_id?: string;
    number?: number;
    title?: string;
    state?: string;
    author?: string | null;
    body?: string | null;
    url?: string | null;
    labels?: string[];
    source_branch?: string | null;
    target_branch?: string | null;
    merged?: boolean;
    provider?: string;
    full_path?: string;
    // File nodes:
    path?: string;
    sha?: string;
    is_dir?: boolean;
    size?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
    // User nodes:
    login?: string;
    [key: string]: unknown;
  };
}

export interface ArtifactNodePage {
  nodes: ArtifactNode[];
  /** Total artifacts matching the type/scope filter across every page. */
  total: number;
  /** Opaque cursor for the next page, omitted when this is the last page. */
  next_cursor?: string;
}

/** One platform source as an organization sees it, with its pin (ADR-0061). */
export interface PlatformPinSource {
  repo: string;
  git_ref: string;
  mode: string;
  pinned_ref?: string | null;
  note?: string | null;
  pinned_by?: string | null;
  pinned_by_name?: string | null;
  pinned_at?: string | null;
}

export interface CatalogNode {
  type_id: string;
  instance_id: string;
  value: {
    /** Whose catalogue it is in (ADR-0042): the platform's, read-only to an
     *  organization, or the organization's own. */
    tier?: ComponentTier;
    /** On a profile: the platform's, with this organization's annotation
     *  laid over it. */
    annotated?: boolean;
    // Gear nodes:
    name?: string;
    kind?: string;
    /** `draft` (a directory of documents, no crate under it) or `published`.
     *  Absent means the scan did not assess this component — a FrontX package
     *  has no crate count, and neither has anything nobody walked. */
    status?: string | null;
    description?: string | null;
    max_version?: string | null;
    newest_version?: string | null;
    max_stable_version?: string | null;
    num_versions?: number | null;
    downloads?: number | null;
    recent_downloads?: number | null;
    repository?: string | null;
    documentation?: string | null;
    homepage?: string | null;
    keywords?: string[];
    categories?: string[];
    // Crate-version nodes:
    crate?: string;
    num?: string;
    yanked?: boolean | null;
    yank_message?: string | null;
    license?: string | null;
    rust_version?: string | null;
    edition?: string | null;
    crate_size?: number | null;
    has_lib?: boolean | null;
    published_by?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    title?: string;
    [key: string]: unknown;
  };
}

export interface ProjectGearRepo {
  project_id?: string;
  tenant?: string;
  connection_id?: string | null;
  repo?: string;
  branch?: string;
}

/** A project source the server could not read, and why: the components
 *  list, the gearbox catalogue and status, and a product check carry these
 *  rather than reading the source as absent. `source` is `owner/repo`, or
 *  `project config` when the project's list of sources itself was not read. */
export interface UnreadableSource {
  /** Absent in the components list (it is about one project already), and
   *  when the organization's projects could not be read at all. */
  project_id?: string | null;
  source: string;
  reason: string;
}

/** Whether product previews run here (`product/gearbox.rs`), and
 *  the gear corpus they resolve against — which a product project's IDE
 *  session checks out beside the project under `source_id`. */
export interface GearboxStatus {
  enabled: boolean;
  engine_version?: string | null;
  corpus_url?: string | null;
  corpus_ref?: string | null;
  corpus_commit?: string | null;
  source_id: string;
  profiles: string[];
  problem?: string | null;
  /** Every gear repository the engine reads, in its order (ADR-0046): the
   *  platform's, or the deployment's corpus while it has none. */
  sources?: GearboxSource[];
  /** The organization's repositories left out: a platform repository has
   *  the same source id. */
  shadowed?: string[];
  /** The organization's project sources the last read could not read. */
  unreadable?: UnreadableSource[];
  /** Where a product's frontend starts in this deployment (`STUDIO_FRONTX_*`);
   *  absent from a backend from before it said (`frontxDefaultsOf`). */
  frontx?: { shell_template: string; source_repo: string; source_ref: string } | null;
}

/** One gear repository as the engine last read it. */
export interface GearboxSource {
  source_id: string;
  /** `owner/repo`. */
  repo: string;
  /** Empty: the repository's default branch. */
  git_ref: string;
  commit?: string | null;
  gears: number;
  /** The gear repository connection; absent for the deployment's corpus. */
  connection_id?: string | null;
  /** The platform's, or the organization's own (ADR-0046 phase 3). */
  tier?: "platform" | "organization";
}

export interface GearboxDiagnostic {
  code: string;
  severity: "error" | "warning" | "info" | string;
  message: string;
  help?: string | null;
  /** `product.gdl`, or the corpus path of the gear.gdl it is about. */
  file?: string | null;
  /** One-based. */
  line?: number | null;
}

export interface GearboxApplication {
  name: string;
  kind: string;
  anchor?: string | null;
  gears: string[];
  replicas: number;
  listens: { name: string; gear: string; address: string }[];
}

/** One thing completion did to the picks, and why. */
export interface ProductChange {
  /** Crate name. */
  gear: string;
  added: boolean;
  reason: string;
  /** A picked gear kept with settings it has yet to be given: their names. */
  needs?: string[];
}

/** Something a product's gears need running beside them. */
export interface ProductTechnology {
  /** `postgres`, `oidc`, `keycloak`, `clickhouse`, ... */
  id: string;
  name: string;
  why: string;
  /** The gears that need it, by crate name. */
  gears: string[];
}

/** The product a project is composing, as the server remembers it. */
/** How a product configures its gears: gear crate name -> field -> value.
 *  Written into product.gdl as the gear's or plugin's `config`. */
export type GearConfig = Record<string, Record<string, unknown>>;

/** One config field of a gear, from its gear.gdl. */
export interface GearConfigField {
  name: string;
  required: boolean;
  /** Absent when the gear has no default. */
  default?: unknown;
  /** Written by generation from the topology (an address); not the product's. */
  derived: boolean;
}

/** An organization's plain explanation of a gear: what it is, what a
 *  product gets from it, when to pick it. `generated` by a model, or
 *  `edited` by a person -- a model never writes over a person's words unless
 *  asked to. */
export interface GearExplanation {
  /** The gear's engine id, as the catalogue keys it. */
  gear_id: string;
  text: string;
  source: "generated" | "edited";
  updated_at: string;
}

/** A gear's config schema, keyed by the name it was asked for. */
export interface GearConfigSchema {
  gear: string;
  /** The engine id; absent when no gear.gdl in the corpus describes it. */
  id?: string | null;
  fields: GearConfigField[];
}

export interface ProjectProduct {
  project_id?: string;
  /** The product's frontend; absent or null when it is gears alone. */
  frontend?: FrontendPick | null;
  /** The product's configuration of its gears (see GearConfig). */
  config?: GearConfig;
  product_id?: string;
  name?: string;
  /** Catalogue names (`cf-gears-api-gateway`), in the order they were picked. */
  gears?: string[];
  /** The profile the old single select checked; nothing reads it now. */
  profile?: string;
  updated_at?: string;
  /** What the engine said of the product, per profile id (ADR-0057). Absent
   *  in a record from before; a check is about the description whose hash it
   *  carries. */
  checks?: Record<string, ProductCheck>;
  /** The latest check, whichever profile it was: kept for older readers. */
  last_preview?: ProductCheck & { profile: string };
  /** Where `product.gdl` was last committed; `path` is relative to the repository root. */
  written?: { branch: string; commit_sha: string; pr_url?: string | null; path?: string };
  /** The description revision Studio keeps (ADR-0053), and its path in the repository. */
  description?: {
    revision: number;
    sha256?: string;
    path?: string | null;
    /** Each source the revision uses, pinned at save (ADR-0060). */
    sources_lock?: { sources: import("../model/source-roles").LockedSource[] } | null;
  };
  /** Where and which revision was last published to the repository (ADR-0053 §3). */
  published?: { revision: number; branch: string; commit_sha: string; pr_url?: string | null; path?: string; at?: string };
}

/** What the engine said of the product for one profile. */
export interface ProductCheck {
  ok: boolean;
  errors: number;
  warnings: number;
  applications: string[];
  /** Every gear the resolution contains, picked or pulled in, by crate. */
  gears: string[];
  corpus_commit?: string | null;
  /** What the gears need running beside them; absent in a record from before. */
  infrastructure?: ProductTechnology[];
  /** The hash of the `product.gdl` it checked; absent in a record from before. */
  gdl_sha256?: string;
}

/** One revision of a product's description, which Studio keeps (ADR-0053). */
export interface ProductDescriptionRevision {
  revision: number;
  text: string;
  author: string;
  created_at: string;
  sha256: string;
  /** `studio`, `repository` (read back from the base branch) or `migrated`. */
  source: string;
  /** Each source the text uses, pinned at save (ADR-0060); empty before locks were kept. */
  sources_lock?: import("../model/source-roles").LockedSource[];
}

/** A project's product description as Studio keeps it. */
export interface ProductDescription {
  latest?: ProductDescriptionRevision | null;
  path?: string | null;
  published?: { revision: number; branch: string; commit_sha: string; pr_url?: string | null; path: string; at?: string | null } | null;
  /** The published file, changed in the repository since: offered as a new revision. */
  repository_change?: { path: string; branch: string; text: string; sha256: string } | null;
}

/** What the Gearbox engine made of a set of picked gears. */
export interface ProductPreview {
  product_gdl: string;
  /** Hex SHA-256 of `product_gdl`; absent from an older backend. */
  gdl_sha256?: string;
  profile: string;
  ok: boolean;
  diagnostics: GearboxDiagnostic[];
  applications: GearboxApplication[];
  gears: { id: string; crate_name: string; reasons: string[] }[];
  added: { id: string; reason: string }[];
  not_described: string[];
  /** Picked hosts without the plugin their extension point needs, and the
   *  engine ids that could fill it. */
  plugin_options: { host: string; available: string[] }[];
  corpus_commit?: string | null;
  /** Set when `write` published it to the repository. */
  written?: { branch: string; commit_sha: string; pr_url?: string | null } | null;
  /** Set when `write` saved it as a revision Studio keeps (ADR-0053). */
  description_revision?: { revision: number; created: boolean; sha256: string } | null;
  /** A save answered before the engine finished checking it: `ok`,
   *  `diagnostics`, `applications` and `gears` are not known yet. The check
   *  carries on and lands in the product's `checks[profile]`. Absent from an
   *  older backend. */
  checking?: boolean;
  /** The project's sources the check could not read, and why: it ran
   *  without them. Absent from an older backend. */
  unreadable?: UnreadableSource[];
}

/** What Declare it is sent (ADR-0041 P3). */
export interface RegistryDeclareInput {
  description?: string;
  capabilities?: string[];
  category?: string;
  dry_run?: boolean;
  project_id?: string;
}

/** What Declare it did, or would do on a dry run. */
export interface RegistryDeclareResult {
  branch: string;
  pr_url?: string | null;
  files: { path: string; content: string }[];
  repo: string;
  path: string;
  dry_run: boolean;
  /** `gear.gdl` (the Gearbox engine's description) or `gear.toml`. Absent from an older backend. */
  manifest?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

/** What a gear scaffold wrote, or would write on a dry run. */
export interface ScaffoldResult {
  branch: string;
  commit_sha: string;
  pr_url?: string | null;
  files: ScaffoldFile[];
  /** `owner/name` written into; absent when there is nowhere to write. */
  repo?: string | null;
  /** Which repository it is: `project`, `organization` or `sources`. */
  target?: "project" | "organization" | "sources" | string | null;
}

/** What a scaffold is sent: the project's route picks the repository. */
export interface ScaffoldBody {
  slug: string;
  problem?: string;
  origin?: string;
  capabilities?: string[];
  category?: string;
  dry_run?: boolean;
  open_pr?: boolean;
}
