/**
 * The wire shapes Organization › Infrastructure reads, copied from the
 * prototype's client (src/api.ts at 00828880) so the models ported with them
 * keep their types: studio-environments (ADR-0043, ADR-0048, ADR-0054–0064),
 * the studio-connector connections its places are, and account-management's
 * users. The list envelopes this kit's service answers with are at the end.
 */

export interface User {
  id: string;
  username: string;
  email?: string;
  display_name?: string;
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

export interface ConnectorIdentity {
  account: string;
  display_name?: string;
  /** What else the test looked at: for a cluster, each right the bootstrap
   *  manifest gives (ADR-0043). Reported only; the test passed regardless. */
  checks?: { name: string; ok: boolean; detail: string }[];
}

export interface ConnectionTest extends ConnectorIdentity {
  connection: Connection;
}

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

/** How long a project's (or every project's) images are kept. */
export interface ImageRetention {
  scope: "project" | "organization";
  keep_last?: number | null;
  keep_days?: number | null;
  /** The project has none of its own: the organization's applies. */
  inherited: boolean;
}

/** The namespace a project was given in an environment (ADR-0062), and where
 *  its builds run there. */
export interface NamespaceAssignment {
  project_id: string;
  environment_id: string;
  namespace: string;
  /** Where its build Job runs; the answer says the namespace itself when the
   *  assignment named none. */
  build_namespace?: string | null;
  /** Who assigned it: a member, or `studio` for a namespace a run made. */
  assigned_by?: string | null;
  assigned_at?: string | null;
}

/** One registry the organization's environments push to or pull from. */
export interface OrgRegistry {
  connection_id: string;
  label: string;
  host: string;
  kind: "ghcr" | "harbor" | "oci";
  prefixes: string[];
  environments: { id: string; name: string }[];
  role: "push" | "pull" | "push_pull";
}

export interface RegistryRepository {
  name: string;
  project_id?: string | null;
  project_name?: string | null;
  /** How many of its versions Studio recorded. */
  recorded: number;
}

export interface RegistryTag {
  /** Absent where the registry's listing does not say it (`VersionDto`). */
  digest?: string | null;
  tags: string[];
  size_bytes?: number | null;
  pushed_at?: string | null;
  image_id?: string | null;
  project_id?: string | null;
  running_in: ImageRunning[];
}

/** Something in a registry that nothing in Studio accounts for. */
export interface RegistryOrphan {
  repository: string;
  digest?: string | null;
  tags: string[];
  reason: "unowned" | "unrecorded" | "undeployed" | "missing";
  image_id?: string | null;
  project_id?: string | null;
}

/** A Constructor Research project, as its integration service names it. */
export interface ResearchProject {
  id: string;
  name: string;
}

/** A hardware configuration of a Research project; a trial one Research ends by its rules. */
export interface ResearchHardware {
  id: string;
  name: string;
  trial: boolean;
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

/** A release as its cluster reports it now. */
export interface DeploymentStatus {
  deployment: Deployment;
  workloads: { name: string; ready: number; desired: number; images: string[] }[];
  hosts: string[];
  /** The containers that cannot start, and why: one line each. Absent from a server before it. */
  problems?: string[];
}

/** The end of one container's log of a deployed release. */
export interface ContainerLog {
  pod: string;
  container: string;
  /** The run before its last restart. */
  previous: boolean;
  text: string;
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

/** Where a component comes from (ADR-0042): `platform` -- the shared set,
 *  synced once for every organization; `organization` -- the organization's
 *  own catalogue and registry; `project` -- declared in this project's own
 *  repositories. */
export type ComponentTier = "platform" | "organization" | "project";

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

/** Something a product's gears need running beside them. */
export interface ProductTechnology {
  /** `postgres`, `oidc`, `keycloak`, `clickhouse`, ... */
  id: string;
  name: string;
  why: string;
  /** The gears that need it, by crate name. */
  gears: string[];
}

/* ── The envelopes the prototype's client spelled inline ── */

/** `GET /environments`: the organization's environments, and what the caller may do. */
export interface EnvironmentList {
  items: DeployEnvironment[];
  total: number;
  may_manage: boolean;
  /** The clusters its projects may put environments of their own on (ADR-0054). */
  open_clusters?: { connection_ids: string[] };
}

export interface Items<T> {
  items: T[];
}

/** studio-kits' `GET /installed-kits`, the part this kit reads: what applies
 *  to the organization, base kits and its own (ADR-0069 §4). */
export interface InstalledKits {
  effective: { kit_slug: string; version: string }[];
}

export interface DeploymentList {
  items: Deployment[];
  total: number;
}

/** A page of a tenant's users, with the cursor to the next. */
export interface UserPage {
  items: User[];
  page_info?: { next_cursor: string | null };
}
