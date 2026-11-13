/**
 * The prototype's client types this kit's screens and moved models use
 * (src/api.ts at 00828880). The product and plan types are the same subset
 * product-mfe's `api/types.ts` carries, for the models moved with it
 * (`entity-gears.ts` → `product-configurator.ts` → `product.ts`).
 * The project domain model's own types live in `model/spec-model.ts`, as they did.
 */
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

/** The deployment profile the project's non-functional statements point to. */
export interface ProfileAdvice {
  /** `dev`, `local` or `prod`, as Studio's `product.gdl` names them. */
  profile: string;
  /** `embedded`, `self_hosted` or `kubernetes`. */
  kind: string;
  because: string[];
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

/** An environment of the project and the product profile it runs there
 *  (ADR-0057): each environment bound at most once, a profile to any number. */
export interface EnvironmentBinding {
  profile: string;
  environment_id: string;
  /** Chart values the release gets there, under what a deploy sets. */
  values?: Record<string, unknown> | null;
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
    sources_lock?: { sources: { id: string; kind: string; repository?: string | null; url: string; branch?: string | null; commit?: string | null }[] } | null;
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

/** An entity of the project domain model as a person edits it on the tab. */
export interface SpecModelEntityEdit {
  name: string;
  definition?: string | null;
  fields: { name: string; meaning: string }[];
  relations: { verb: string; target: string }[];
}

/** A sentence proposed for a document, after the passage at `line` of the
 *  revision the model read. */
export interface SpecModelSentence {
  path: string;
  revision: string;
  line: number;
  sentence: string;
  /** What it makes better: the pull request's title. */
  why?: string | null;
}

/** One term of the project's glossary document. */
export interface GlossaryDocRow {
  term: string;
  definition: string;
  aliases: string[];
  not_same_as: string[];
  source?: string | null;
}

/** The glossary the project's documents keep, and where Studio keeps it. */
export interface GlossaryDoc {
  found: {
    path: string;
    /** The section's heading, for a glossary kept inside another document. */
    heading?: string | null;
    line_start: number;
    line_end: number;
    /** The whole document is the glossary. */
    whole: boolean;
    rows: GlossaryDocRow[];
  } | null;
  path: string;
}

/** A hypothesis check method a kit adds (its `check-methods.json`). */
export interface KitCheckMethod {
  kit: string;
  id: string;
  label: string;
  uncertainty: string;
  inputs: string;
  action: string;
  limits: string;
  applies_to: string[];
}

/** Where a change to the documents landed. */
export interface SpecModelWrite {
  path: string;
  branch: string;
  commit_sha: string;
  pr_url?: string | null;
}

/** The pull request that renames a word across the documents. */
export interface GlossaryRenameProposal {
  files: string[];
  renamed: number;
  branch: string;
  commit_sha: string;
  pr_url?: string | null;
}

/** One repository this kit has been materialized into. A kit is installed into
 * a PROJECT and materialized per repository, so this is a list: a project can
 * gain a repository after the kit was requested, and each target carries its
 * own version and outcome. */
export interface KitMaterialization {
  repository_id: string;
  repository_label?: string;
  version: string;
  status: "installed" | "failed";
  materialized_at: string;
  failure_reason?: string;
}

/** Project-scoped desired state. The trusted IDE runner advances `pending` to
 * `installed`; the browser never executes kit scripts itself. */
export interface KitInstallation {
  kit_slug: string;
  version: string;
  source: string;
  repository_url: string;
  install_mode: "copy" | "register";
  status: "pending" | "installing" | "installed" | "failed";
  requested_by: string;
  requested_at: string;
  installed_at?: string;
  /** Where this kit BELONGS: `project` (the project repository alone) or
   *  `all-repositories`. Intent, as opposed to `materializations`, which is
   *  where it actually is — reconciling is the difference between the two.
   *  Optional for the same rolling-deploy reason as `materializations`. */
  scope?: "project" | "all-repositories";
  /** The most recently materialized target, derived by the backend from
   *  `materializations`. */
  repository_id?: string;
  /** Optional on purpose: during a rolling deploy the portal can be newer than
   *  the backend answering it, and a missing list must degrade to "no detail"
   *  rather than throw in the render. */
  materializations?: KitMaterialization[];
  failure_reason?: string;
}

/** A document the documents gear created: only what this kit reads of it. */
export interface Doc {
  id: string;
  title?: string;
}
