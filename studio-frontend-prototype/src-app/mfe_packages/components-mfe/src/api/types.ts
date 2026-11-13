/**
 * The wire shapes the Components kit reads, carried over from the prototype's
 * `api.ts` (at 00828880) as they were: the `studio-components-catalog` gear's
 * registry, catalogue, field schemas, sources and publication requests, plus
 * the few shapes it borrows from `studio-connector`, `studio-kits`,
 * `studio-user` and `studio-tasks`.
 */

/** Where a component comes from (ADR-0042): `platform` -- the shared set,
 *  synced once for every organization; `organization` -- the organization's
 *  own catalogue and registry; `project` -- declared in this project's own
 *  repositories. */
export type ComponentTier = 'platform' | 'organization' | 'project';

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
    /** `draft` (a directory of documents, no crate under it) or `published`. */
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

/** The platform's catalogue sources (ADR-0042): a platform administrator's. */
export interface PlatformSources {
  items: CatalogRepoSource[];
  total: number;
  /** The crates.io keyword; null for none. */
  crates_io: string | null;
}

/** One field's answer, as the catalogue stores it. */
export interface FieldVal {
  v?: string;
  b?: string;
  n?: number;
  s?: 'good' | 'watch' | 'bad' | 'none';
  l?: string;
  u?: string;
}

/** One place a component's facts came from. */
export interface ComponentSource {
  kind: 'crates_io' | 'repository' | 'roadmap' | 'gearbox' | 'person' | string;
  label: string;
}

/** One component with its three sources reconciled: crates.io < scan < profile. */
export interface ComponentValues {
  name: string;
  values: Record<string, FieldVal | null>;
  category: string;
  sources?: ComponentSource[];
  planned?: boolean;
  tier?: ComponentTier;
}

export interface FieldSchemaSource {
  class: 'repo' | 'api' | 'manual' | 'none';
  ref: string;
}

export interface FieldSchemaField {
  key: string;
  label: string;
  kind: 'text' | 'label' | 'docstate' | 'bool' | 'metric' | 'status';
  lamp: boolean;
  source: FieldSchemaSource;
  example?: string;
  domain?: Record<string, unknown>;
}

export interface FieldSchemaGroup {
  id: string;
  title: string;
  icon: string;
  fields: FieldSchemaField[];
}

/** The presentation of one component type, served by the catalogue. */
export interface FieldSchema {
  /** The GTS type this schema is the presentation of. */
  describes: string;
  groups: FieldSchemaGroup[];
  composition: { key: string; label: string; color: string }[];
  statusLegend: Record<string, string>;
  docStateLegend: Record<string, string>;
  sourceClasses: Record<string, { label: string; hint: string }>;
  owner: 'builtin' | 'tenant';
  /** Whether this organization treats the type as a component. */
  component: boolean;
}

/** A versioned capability bundle published in the Studio kit registry. */
export interface StudioKit {
  slug: string;
  name: string;
  description: string;
  publisher: string;
  visibility: string;
  source: string;
  repository_url: string;
  default_version: string;
  manifest_path: string;
}

export interface Connection {
  id: string;
  owner_tenant_id: string;
  provider: string;
  label: string;
  account: string;
  base_url: string;
  /** personal | workspace | organization */
  scope: string;
  secret_ref: string;
  created_at_epoch_secs: number;
  options?: Record<string, string>;
  mine?: boolean;
}

/* ── the registry (ADR-0041) ─────────────────────────────────────────────── */

/** Who answers for a registry entry. */
export interface RegistryOwner {
  kind: 'person' | 'team';
  id?: string | null;
  name: string;
}

/** Where a registry entry was found. */
export interface RegistryOccurrence {
  project_id?: string | null;
  project_name?: string | null;
  repo: string;
  git_ref?: string | null;
  path: string;
  commit?: string | null;
  /** `gear.toml`, `gear.gdl`, `attribute`, `package`, `kit` or `detected`. */
  declared_in: string;
  /** `project`, or `organization` for the organization's gear repository. */
  scope?: 'project' | 'organization' | string;
}

export interface RegistryContribution {
  repo: string;
  branch: string;
  pr_url?: string | null;
  path: string;
  files: number;
  at: string;
  by: string;
  by_name?: string | null;
}

/** A gear leaving its project for the organization's gear repository (ADR-0044 §1). */
export interface RegistryExtraction {
  crate_name: string;
  version: string;
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

/** A project that uses a registry entry it does not declare. */
export interface RegistryConsumer {
  project_id: string;
  project_name: string;
  via: string[];
}

/** What `POST /registry/{name}/suggest` proposed. */
export interface RegistrySuggestion {
  description?: string | null;
  category?: string | null;
  capabilities: string[];
  at: string;
  /** `provider:model`. */
  model: string;
}

/** One decision a person made about a registry entry (ADR-0041 P2). */
export interface RegistryDecision {
  action: string;
  from: string;
  to: string;
  by: string;
  by_name?: string | null;
  at: string;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

/** One signal a candidate detector found (ADR-0041 P3). */
export interface RegistryEvidence {
  signal: string;
  detail: string;
  weight: number;
}

/** What a `publish` would write into the platform's gear repository. */
export interface RegistryPublishPreview {
  repo: string;
  base_branch: string;
  branch: string;
  path: string;
  files: string[];
  skipped: string[];
  title: string;
  source_id?: string | null;
  targets?: { source_id: string; repo: string; gears_in_category: number }[];
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
  branch: string;
  skipped: string[];
  manifest?: string | null;
}

/** One component of the organization's registry (ADR-0041). */
export interface RegistryEntry {
  name: string;
  kind: string;
  state: string;
  description?: string | null;
  category?: string | null;
  owner?: RegistryOwner | null;
  capabilities: string[];
  aliases?: string[];
  merged_into?: string | null;
  replaced_by?: string | null;
  version?: string | null;
  contribution?: RegistryContribution | null;
  extraction?: RegistryExtraction | null;
  consumers?: RegistryConsumer[];
  suggestion?: RegistrySuggestion | null;
  decisions?: RegistryDecision[] | null;
  orphaned: boolean;
  first_seen?: string | null;
  last_seen?: string | null;
  score?: number | null;
  evidence?: RegistryEvidence[];
  occurrences: RegistryOccurrence[];
  publish_preview?: RegistryPublishPreview | null;
  extract_preview?: RegistryExtractPreview | null;
}

/** What `POST /registry/{name}/decisions` takes. */
export interface RegistryDecisionInput {
  action: string;
  reason?: string;
  owner?: RegistryOwner;
  kind?: string;
  category?: string | null;
  capabilities?: string[];
  description?: string | null;
  replaced_by?: string;
  merge_into?: string;
  version?: string;
  dry_run?: boolean;
  target?: string;
}

/** What `POST /registry/{name}/declare` takes; all optional. */
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
  manifest?: string;
}

/** What the last registry walk saw of one project. */
export interface RegistryProjectWalk {
  project_id: string;
  project_name: string;
  at: string;
  error?: string | null;
  repos: {
    repo: string;
    /** `read`, `unchanged` or `failed`. */
    status: string;
    components: number;
    error?: string | null;
    hint?: string | null;
  }[];
}

/** One place a readiness check fails at. */
export interface ReadinessSpot {
  path: string;
  line?: number | null;
  text?: string | null;
}

/** One readiness check (ADR-0044 §1). */
export interface ReadinessCheck {
  key: string;
  ok: boolean;
  blocks: boolean;
  summary: string;
  spots: ReadinessSpot[];
  more: number;
}

/** What `GET /registry/{name}/readiness` answered. */
export interface RegistryReadiness {
  name: string;
  ready: boolean;
  /** `module` or `crate`. */
  kind: string;
  repo: string;
  git_ref?: string | null;
  project_name?: string | null;
  path: string;
  module_path?: string | null;
  files: number;
  checks: ReadinessCheck[];
  dependencies: { name: string; spec?: string | null }[];
  gears: string[];
  outside_read: number;
  outside_total: number;
}

/* ── the platform (ADR-0042 §4) ───────────────────────────────────────────── */

/** An organization's request that the platform take one of its gears. */
export interface PublicationRequest {
  organization_id: string;
  organization_name?: string | null;
  name: string;
  version?: string | null;
  reason?: string | null;
  requested_by: string;
  requested_by_name?: string | null;
  at: string;
}

/** A person who may publish into the platform beside its administrators. */
export interface GearCurator {
  id: string;
  name?: string | null;
}

/* ── borrowed from other gears ───────────────────────────────────────────── */

/** One member of an organization (`studio-user`), as much as naming one needs. */
export interface OrgMember {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
}

/** A colleague of the caller (`studio-user`), as much as naming one needs. */
export interface Colleague {
  user_id: string;
  display_name?: string | null;
}

/** The caller's Studio person (`GET /studio-user/v1/me`). */
export interface StudioProfile {
  id: string;
  display_name?: string | null;
  email?: string | null;
}

/** A `studio-tasks` run, as much of it as waiting on one needs. */
export interface TaskRun {
  id: string;
  state: string;
  progress?: string | null;
  summary?: string | null;
  last_error?: string | null;
  result?: Record<string, unknown> | null;
}

/** A page of anything the gears list by `offset`/`limit`. */
export interface Page<T> {
  items: T[];
  total?: number;
}
