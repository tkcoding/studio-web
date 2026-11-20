//! GTS identifiers, type schemas and instance normalization for artifacts.
//!
//! Type ids and the free-form registration documents live here; the full
//! property schemas are in `studio-backend/gts/artifact/*.schema.json` (the
//! graph-store contract). Instance ids are deterministic (uuid5 of a stable
//! key) so re-syncing the same entity upserts rather than duplicates.

use serde_json::{Value, json};
use uuid::Uuid;

use super::comment_threads::{ThreadCounts, Waiting};
use super::graph::{GtsEdge, GtsNode};
use crate::connectors::sdk::{
    Mention, PullRequestThreads, RemoteBuildArtifact, RemoteComment, RemoteCommit, RemoteFile,
    RemoteIssue, RemotePullRequest, RemoteRelease, RemoteWorkflowJob, RemoteWorkflowRun,
};

/// Fixed namespace for uuid5 instance ids (studio artifact graph).
const INSTANCE_NS: Uuid = Uuid::from_u128(0xcf57_0000_0000_4000_8000_0000_0000_0001);

pub const REPO_TYPE: &str = "gts.cf.studio.artifact.repo.v1~";
pub const ISSUE_TYPE: &str = "gts.cf.studio.artifact.issue.v1~";
pub const PULL_REQUEST_TYPE: &str = "gts.cf.studio.artifact.pull_request.v1~";
pub const FILE_TYPE: &str = "gts.cf.studio.artifact.file.v1~";
pub const USER_TYPE: &str = "gts.cf.studio.artifact.user.v1~";
/// A spec-quality finding about a document (bloat / traceability / leak /
/// purpose). Materialized from a detector result by the portal.
pub const SPEC_FINDING_TYPE: &str = "gts.cf.studio.artifact.spec_finding.v1~";
/// A comment on an issue or pull request.
pub const COMMENT_TYPE: &str = "gts.cf.studio.artifact.comment.v1~";
/// A commit in a repository.
pub const COMMIT_TYPE: &str = "gts.cf.studio.artifact.commit.v1~";
/// A CI run in a repository: one run of one workflow on one commit
/// (ADR-0045). A build of the project's product, when its workflow builds it.
pub const WORKFLOW_RUN_TYPE: &str = "gts.cf.studio.artifact.workflow_run.v1~";
/// One job of a CI run's latest attempt: which part of the run failed, and at
/// which step. Beside the run rather than inside it, so a sync that re-reads
/// the run without its jobs does not wipe them.
pub const WORKFLOW_JOB_TYPE: &str = "gts.cf.studio.artifact.workflow_job.v1~";
/// A build of the project's product that the IDE ran -- in a member's desktop
/// or in a session -- and reported (ADR-0045 phase 2): what was built, where,
/// and with what result. Written by the report, never edited once finished.
pub const BUILD_TYPE: &str = "gts.cf.studio.artifact.build.v1~";
/// A file a CI run uploaded and the provider keeps for a while: what a build
/// produced. Only its description is here; the bytes stay with the provider
/// and are downloaded through a link it signs.
pub const BUILD_ARTIFACT_TYPE: &str = "gts.cf.studio.artifact.build_artifact.v1~";
/// A release of a repository: a tag, its notes' title and the files attached
/// to it (`assets` in the payload).
pub const RELEASE_TYPE: &str = "gts.cf.studio.artifact.release.v1~";
/// What search sees of a file's text: a bounded excerpt, beside the file
/// rather than inside it.
///
/// It used to be a field of the file node, and every listing of files paid
/// for it. graph-storage projects whole payloads — it cannot select fields —
/// so the Specs screen, which wants a path and a repository per file, read
/// 2.3 KB of excerpt out of every 2.7 KB file node, and a tenant's 9,577 files
/// took 48 pages and eight seconds to walk. Search is the only reader the
/// excerpt ever had, and search reaches it here just as well.
pub const FILE_CONTENT_TYPE: &str = "gts.cf.studio.artifact.file_content.v1~";
/// A member's decision on one mapping of a specification to a gear: which
/// gear covers a capability a document declares, or that it does not
/// (`cpt-studio-fr-mapping-decisions`).
pub const MAPPING_DECISION_TYPE: &str = "gts.cf.studio.artifact.mapping_decision.v1~";
/// One run of a matcher on a project's specification, kept for the gears-matcher pilot
/// (HYP-3182). Separate from [`MAPPING_DECISION_TYPE`] on purpose: a pilot record never
/// re-ranks the keyword matcher's results. Dropped as a whole when the pilot ends.
pub const MATCHER_RUN_TYPE: &str = "gts.cf.studio.artifact.matcher_run.v1~";
/// What a member did with one suggestion of a matcher run (accepted, rejected, missed or
/// skipped), kept for the pilot (HYP-3182). Same shape for both matchers, so the two compare.
pub const MATCHER_CHOICE_TYPE: &str = "gts.cf.studio.artifact.matcher_choice.v1~";

/// Every artifact node type, for registering and enumerating.
pub const ALL_NODE_TYPES: [&str; 17] = [
    REPO_TYPE,
    ISSUE_TYPE,
    PULL_REQUEST_TYPE,
    FILE_TYPE,
    USER_TYPE,
    SPEC_FINDING_TYPE,
    COMMENT_TYPE,
    COMMIT_TYPE,
    FILE_CONTENT_TYPE,
    MAPPING_DECISION_TYPE,
    MATCHER_RUN_TYPE,
    MATCHER_CHOICE_TYPE,
    WORKFLOW_RUN_TYPE,
    WORKFLOW_JOB_TYPE,
    BUILD_TYPE,
    BUILD_ARTIFACT_TYPE,
    RELEASE_TYPE,
];

/// The node types the artifact listing returns by default — the four
/// first-class artifacts. The rest (`user`, `spec_finding`, `comment`,
/// `commit`) are graph detail: present in the graph, but only listed when a
/// caller asks for one explicitly by its GTS type id.
pub const LISTABLE_NODE_TYPES: [&str; 4] = [REPO_TYPE, FILE_TYPE, ISSUE_TYPE, PULL_REQUEST_TYPE];

/// Resolve the listing `type` filter into the concrete node types to project.
///
/// * `None` -> [`LISTABLE_NODE_TYPES`] (the four first-class artifacts).
/// * `Some(id)` -> that one type, matched by its full GTS id
///   (`gts.cf.studio.artifact.<t>.v1~`); the bare leaf (`issue`, `file`, ...)
///   is also accepted for older callers. An unknown value resolves to nothing,
///   so a typo lists no rows rather than silently listing everything.
pub fn resolve_listable_types(type_filter: Option<&str>) -> Vec<&'static str> {
    match type_filter.map(str::trim).filter(|s| !s.is_empty()) {
        None => LISTABLE_NODE_TYPES.to_vec(),
        Some(f) => ALL_NODE_TYPES
            .into_iter()
            .filter(|t| is_listed(t))
            .filter(|t| *t == f || type_leaf(t) == f)
            .collect(),
    }
}

/// Whether nodes of this type are ever listed — by `/nodes`, the artifact
/// index or anything else that reads the graph back as rows.
///
/// Every type is, except a file's content. It is not an artifact but a part of
/// one, reached only through search, and it is the bytes that listing files
/// stopped carrying: listing it, or mirroring it into the index, would put them
/// straight back.
pub fn is_listed(type_id: &str) -> bool {
    type_id != FILE_CONTENT_TYPE
}

/// The leaf name of an artifact type id: `issue` from
/// `gts.cf.studio.artifact.issue.v1~` (the token before the version).
fn type_leaf(type_id: &str) -> &str {
    let toks: Vec<&str> = type_id.trim_end_matches('~').split('.').collect();
    if toks.len() >= 2 {
        toks[toks.len() - 2]
    } else {
        type_id
    }
}

// ── Relation (edge) types ── namespace `rel`. Endpoints are node instance ids.
/// issue / pull_request → repo.
pub const REL_ARTIFACT_OF: &str = "gts.cf.studio.rel.artifact_of.v1~";
/// repo → file.
pub const REL_CONTAINS: &str = "gts.cf.studio.rel.contains.v1~";
/// issue / pull_request → user (the author).
pub const REL_AUTHORED_BY: &str = "gts.cf.studio.rel.authored_by.v1~";
/// pull_request → file (a file the PR changed).
pub const REL_MODIFIES: &str = "gts.cf.studio.rel.modifies.v1~";
/// document ↔ document — near-duplicate found by the bloat detector.
pub const REL_DUPLICATES: &str = "gts.cf.studio.rel.duplicates.v1~";
/// document → document — a traceability link from the traceability detector.
pub const REL_TRACES_TO: &str = "gts.cf.studio.rel.traces_to.v1~";
/// spec_finding → document — the document a finding is about.
pub const REL_FINDING_ON: &str = "gts.cf.studio.rel.finding_on.v1~";
/// comment → issue / pull_request — the artifact a comment is on.
pub const REL_COMMENT_ON: &str = "gts.cf.studio.rel.comment_on.v1~";
/// file_content → file — the file an excerpt was taken from.
pub const REL_CONTENT_OF: &str = "gts.cf.studio.rel.content_of.v1~";
/// mapping_decision → document: the document whose capability it decides.
pub const REL_DECISION_ON: &str = "gts.cf.studio.rel.decision_on.v1~";
/// pull_request → user: an account asked to review it, or that reviewed it.
pub const REL_REVIEWED_BY: &str = "gts.cf.studio.rel.reviewed_by.v1~";
/// pull_request → user: an account it is assigned to.
pub const REL_ASSIGNED_TO: &str = "gts.cf.studio.rel.assigned_to.v1~";
/// pull_request → issue: an issue its merge closes (ADR-0047 §3).
pub const REL_CLOSES: &str = "gts.cf.studio.rel.closes.v1~";
/// pull_request → issue / pull_request: an item its text names otherwise.
pub const REL_REFERENCES: &str = "gts.cf.studio.rel.references.v1~";
/// issue → issue: the work item this one is part of.
pub const REL_PART_OF: &str = "gts.cf.studio.rel.part_of.v1~";

/// Every relation type, for registering in the graph.
pub const ALL_EDGE_TYPES: [&str; 15] = [
    REL_ARTIFACT_OF,
    REL_CONTAINS,
    REL_AUTHORED_BY,
    REL_MODIFIES,
    REL_DUPLICATES,
    REL_TRACES_TO,
    REL_FINDING_ON,
    REL_COMMENT_ON,
    REL_CONTENT_OF,
    REL_DECISION_ON,
    REL_REVIEWED_BY,
    REL_ASSIGNED_TO,
    REL_CLOSES,
    REL_REFERENCES,
    REL_PART_OF,
];

/// The graph-storage families our types derive from.
///
/// Derivation is not decoration: `family` is declared required with no default
/// on the two bases, so a type deriving straight from a base resolves no family
/// and cannot be instantiated. Artifacts are *owned* nodes — the graph is their
/// system of record here — and the relations are *static* edges, replaced
/// wholesale by a re-sync.
const OWNED_NODE_FAMILY: &str = "gts.cf.core.graph.node.v1~cf.core.graph.owned_node.v1~";
const STATIC_EDGE_FAMILY: &str = "gts.cf.core.graph.edge.v1~cf.core.graph.static_edge.v1~";

/// The type id the graph-storage gear stores this artifact type under.
///
/// A derived type carries its ancestry in the identifier: our
/// `gts.cf.studio.artifact.file.v1~` becomes
/// `gts.cf.core.graph.node.v1~cf.core.graph.owned_node.v1~cf.studio.artifact.file.v1~`.
pub fn graph_type_id(our_type: &str) -> String {
    let leaf = our_type.strip_prefix("gts.").unwrap_or(our_type);
    let family = if ALL_EDGE_TYPES.contains(&our_type) {
        STATIC_EDGE_FAMILY
    } else {
        OWNED_NODE_FAMILY
    };
    format!("{family}{leaf}")
}

/// Reverse of [`graph_type_id`]: map a graph-storage type id back to our
/// `&'static` constant so a node read back becomes a [`GtsNode`].
pub fn our_type_from_graph(graph_type: &str) -> Option<&'static str> {
    ALL_NODE_TYPES
        .into_iter()
        .find(|t| graph_type_id(t) == graph_type)
}

/// The node types, with a title and a description each.
const NODE_TYPE_DOCS: [(&str, &str, &str); 17] = [
    (
        REPO_TYPE,
        "Repository",
        "A source repository ingested from a connector.",
    ),
    (
        ISSUE_TYPE,
        "Issue",
        "An issue pulled from the connector API.",
    ),
    (
        PULL_REQUEST_TYPE,
        "PullRequest",
        "A pull/merge request pulled from the connector API.",
    ),
    (
        FILE_TYPE,
        "File",
        "A file in the repository tree pulled from the connector API.",
    ),
    (
        USER_TYPE,
        "User",
        "An account that authored issues, pull requests, comments or commits.",
    ),
    (
        SPEC_FINDING_TYPE,
        "SpecFinding",
        "A spec-quality finding (bloat/traceability/leak/purpose) about a document.",
    ),
    (
        COMMENT_TYPE,
        "Comment",
        "A comment on an issue or pull request pulled from the connector API.",
    ),
    (
        COMMIT_TYPE,
        "Commit",
        "A commit in the repository pulled from the connector API.",
    ),
    (
        FILE_CONTENT_TYPE,
        "FileContent",
        "A bounded excerpt of a text file, kept beside the file for search.",
    ),
    (
        MAPPING_DECISION_TYPE,
        "MappingDecision",
        "A member's decision on which gear covers a capability a document declares.",
    ),
    (
        MATCHER_RUN_TYPE,
        "MatcherRun",
        "One run of a spec-to-gears matcher, kept for the gears-matcher pilot.",
    ),
    (
        MATCHER_CHOICE_TYPE,
        "MatcherChoice",
        "What a member did with one suggestion of a matcher run, kept for the gears-matcher pilot.",
    ),
    (
        WORKFLOW_RUN_TYPE,
        "WorkflowRun",
        "A CI run of one workflow on one commit, pulled from the connector API.",
    ),
    (
        WORKFLOW_JOB_TYPE,
        "WorkflowJob",
        "One job of a CI run's latest attempt and the step it failed at, pulled from the connector API.",
    ),
    (
        BUILD_TYPE,
        "Build",
        "A build of the project's product that the IDE ran and reported.",
    ),
    (
        BUILD_ARTIFACT_TYPE,
        "BuildArtifact",
        "A file a CI run uploaded and the provider keeps, pulled from the connector API.",
    ),
    (
        RELEASE_TYPE,
        "Release",
        "A release of a repository and the files attached to it, pulled from the connector API.",
    ),
];

/// The relation types, with a title and a description each — the catalog side
/// of [`ALL_EDGE_TYPES`].
const EDGE_TYPE_DOCS: [(&str, &str, &str); 15] = [
    (
        REL_ARTIFACT_OF,
        "ArtifactOf",
        "An issue or pull request and the repository it belongs to.",
    ),
    (
        REL_CONTAINS,
        "Contains",
        "A repository and a file in its tree.",
    ),
    (
        REL_AUTHORED_BY,
        "AuthoredBy",
        "An issue or pull request and the account that authored it.",
    ),
    (
        REL_MODIFIES,
        "Modifies",
        "A pull request and a file it changed.",
    ),
    (
        REL_DUPLICATES,
        "Duplicates",
        "Two documents the bloat detector found to be near-duplicates.",
    ),
    (
        REL_TRACES_TO,
        "TracesTo",
        "A traceability link between two documents, from the traceability detector.",
    ),
    (
        REL_FINDING_ON,
        "FindingOn",
        "A spec-quality finding and the document it is about.",
    ),
    (
        REL_COMMENT_ON,
        "CommentOn",
        "A comment and the issue or pull request it is on.",
    ),
    (
        REL_CONTENT_OF,
        "ContentOf",
        "A file's searchable excerpt and the file it was taken from.",
    ),
    (
        REL_DECISION_ON,
        "DecisionOn",
        "A mapping decision and the document whose capability it decides.",
    ),
    (
        REL_REVIEWED_BY,
        "ReviewedBy",
        "A pull request and an account asked to review it or that reviewed it.",
    ),
    (
        REL_ASSIGNED_TO,
        "AssignedTo",
        "A pull request and an account it is assigned to.",
    ),
    (
        REL_CLOSES,
        "Closes",
        "A pull request and an issue its merge closes.",
    ),
    (
        REL_REFERENCES,
        "References",
        "A pull request and an issue or pull request its text names.",
    ),
    (
        REL_PART_OF,
        "PartOf",
        "An issue and the issue it is part of.",
    ),
];

/// GTS Type Schemas registered with the **platform types-registry** at gear
/// init. Declared free-form (`type: object`) — the same shape the studio types
/// use in `config/*.yaml` — so registration never trips the closed-envelope
/// narrowing check; the full property schemas live alongside as JSON files and
/// are the graph contract.
///
/// Nodes *and* relations, and no type is held back: the platform registry is
/// the catalog of everything, so every type this gear puts in graph-storage
/// must be findable here too. `crate::gts_inventory` asserts that direction as
/// an invariant — a graph type with no catalog entry is a registry that
/// disagrees with the graph.
pub fn type_schemas() -> Vec<Value> {
    NODE_TYPE_DOCS
        .into_iter()
        .chain(EDGE_TYPE_DOCS)
        .map(|(id, title, description)| {
            json!({
                "$id": format!("gts://{id}"),
                "$schema": "http://json-schema.org/draft-07/schema#",
                "title": title,
                "description": description,
                "type": "object",
            })
        })
        .collect()
}

/// Payload paths the gear indexes for lexical search, declared once on every
/// artifact type. The gear composes the search text from these on write, so a
/// producer no longer supplies a `search_text` string; a path a node's payload
/// does not have is simply skipped.
///
/// `text_excerpt` is still here, and so still on the file type, although no
/// file node carries one any more. It cannot come off: graph-storage holds a
/// registered schema immutable, and `file.v1` re-registered with other traits
/// is a conflict that fails the whole registration batch, on every tenant that
/// already has the old one. A `file.v2` would not help either — a node's type
/// cannot change under its key, so it would mean a new key for every file and
/// for every binding and relation that names one. Left declared, the path
/// resolves to nothing on a file and costs nothing.
const FULL_TEXT_PATHS: [&str; 12] = [
    "/payload/title",
    "/payload/path",
    "/payload/full_path",
    "/payload/state",
    "/payload/author",
    "/payload/login",
    "/payload/labels",
    "/payload/body",
    "/payload/message",
    "/payload/summary",
    "/payload/severity",
    "/payload/text_excerpt",
];

/// Payload paths the gear embeds — what a node "is about", so a semantic hit
/// and a keyword hit agree on the same content. Identifiers and states carry
/// no meaning a vector could rank, so they stay lexical-only.
const VECTOR_PATHS: [&str; 8] = [
    "/payload/title",
    "/payload/path",
    "/payload/full_path",
    "/payload/body",
    "/payload/message",
    "/payload/summary",
    "/payload/login",
    "/payload/text_excerpt",
];

/// What the file-content type searches and embeds: the excerpt, and the path
/// beside it, which is what the file type searched and embedded for a text
/// file before the two were split — so a query ranks the same text as it did.
///
/// Its own declaration rather than the shared one, because a new type is free
/// to say exactly what it holds.
const CONTENT_PATHS: [&str; 2] = ["/payload/path", "/payload/text_excerpt"];

/// The same types as **graph-storage** ontology entries.
///
/// A separate document set, because the two registries answer different
/// questions: the platform registry catalogs what a studio artifact is, while
/// graph-storage needs a type that derives from one of its families — a type
/// deriving straight from a base fixes no `family` and is refused, and one
/// declared free-form has no chain to validate against at all. The traits
/// declare which payload paths the gear searches and embeds.
pub fn graph_node_type_schemas() -> Vec<Value> {
    NODE_TYPE_DOCS
        .into_iter()
        .map(|(id, title, description)| {
            let mut schema = derived_schema(id, title, description, OWNED_NODE_FAMILY);
            schema["x-gts-traits"] = if id == FILE_CONTENT_TYPE {
                json!({
                    "full_text_search": CONTENT_PATHS,
                    "vector_search": CONTENT_PATHS,
                })
            } else {
                json!({
                    "full_text_search": FULL_TEXT_PATHS,
                    "vector_search": VECTOR_PATHS,
                })
            };
            schema
        })
        .collect()
}

/// The relation types, deriving from the static-edge family: they are replaced
/// by a scope re-sync, unlike analysis edges.
pub fn graph_edge_type_schemas() -> Vec<Value> {
    ALL_EDGE_TYPES
        .into_iter()
        .map(|id| {
            derived_schema(
                id,
                "Relation",
                "A relation between two artifact nodes.",
                STATIC_EDGE_FAMILY,
            )
        })
        .collect()
}

fn derived_schema(id: &str, title: &str, description: &str, family: &str) -> Value {
    json!({
        "$id": format!("gts://{}", graph_type_id(id)),
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": title,
        "description": description,
        "type": "object",
        "allOf": [{ "$ref": format!("gts://{family}") }],
    })
}

/// Deterministic instance id from a stable composite key.
fn anon_id(parts: &[&str]) -> String {
    Uuid::new_v5(&INSTANCE_NS, parts.join("|").as_bytes()).to_string()
}

/// The repository node. `scope_key` is the project (or workspace for a
/// workspace-level source), so attaching the same connection/repository to
/// two Studio projects creates two independently scoped artifact graphs.
pub fn repo_node(
    scope_key: &str,
    connector_id: &str,
    provider: &str,
    repo_full_path: &str,
) -> GtsNode {
    GtsNode {
        type_id: REPO_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "repo"]),
        value: json!({
            "connector_id": connector_id,
            "provider": provider,
            "full_path": repo_full_path,
        }),
    }
}

/// The repository node a sync writes as it starts: [`repo_node`], carrying
/// over whatever `prior` — the node as the last sync left it — says beyond
/// that. So `synced_at` and the counts of the last finished sync stay while a
/// sync runs and after one that fails; only [`repo_synced_node`], written
/// when a sync finishes, moves them on.
pub fn repo_node_keeping(
    scope_key: &str,
    connector_id: &str,
    provider: &str,
    repo_full_path: &str,
    prior: Option<&Value>,
) -> GtsNode {
    let mut node = repo_node(scope_key, connector_id, provider, repo_full_path);
    if let (Some(obj), Some(prior)) = (node.value.as_object_mut(), prior.and_then(Value::as_object))
    {
        for (key, value) in prior {
            obj.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    node
}

/// What a completed sync pulled for one repository — recorded on the repo node
/// so a reader can tell a never-synced source from a synced one without
/// counting its children.
#[derive(Debug, Clone, Default)]
pub struct RepoSyncStats {
    pub issues: usize,
    pub pull_requests: usize,
    pub files: usize,
    pub comments: usize,
    pub commits: usize,
    /// Unresolved review threads across the repository's open pull requests,
    /// or `None` when the provider cannot say.
    ///
    /// Absent rather than zero. A GitLab source has no answer here, and
    /// writing `0` would claim nothing is waiting on review — a different,
    /// and often wrong, statement. The key is simply omitted, so a reader
    /// distinguishes "none open" from "never asked".
    pub open_review_threads: Option<usize>,
    /// Unresolved comment threads the repository carries in `.studio/comments`,
    /// across every document — the conversation about the work, where
    /// `open_review_threads` is the conversation about the code under review.
    ///
    /// Absent when the sync had no checkout to read, for the same reason as its
    /// neighbour: a repository listed through a connector's tree API has no
    /// sidecars in hand, and `0` would claim it has none.
    pub open_document_threads: Option<usize>,
    /// CI runs read (ADR-0045); `None` when they could not be read, and then
    /// `ci_error` says why -- so the Builds tab tells "this repository has no
    /// runs" from "Studio could not read its runs".
    pub ci_runs: Option<usize>,
    pub ci_error: Option<String>,
}

/// The repository node re-stated once a sync has finished: same instance id as
/// [`repo_node`], so it upserts over the record written when the sync started,
/// plus when it finished and what came in. This is the repository's sync status
/// as far as any reader is concerned.
pub fn repo_synced_node(
    scope_key: &str,
    connector_id: &str,
    provider: &str,
    repo_full_path: &str,
    synced_at: &str,
    stats: RepoSyncStats,
    waiting: &[Waiting],
) -> GtsNode {
    let mut node = repo_node(scope_key, connector_id, provider, repo_full_path);
    if let Some(obj) = node.value.as_object_mut() {
        obj.insert("synced_at".to_string(), json!(synced_at));
        obj.insert("issues".to_string(), json!(stats.issues));
        obj.insert("pull_requests".to_string(), json!(stats.pull_requests));
        obj.insert("files".to_string(), json!(stats.files));
        obj.insert("comments".to_string(), json!(stats.comments));
        obj.insert("commits".to_string(), json!(stats.commits));
        if let Some(open) = stats.open_review_threads {
            obj.insert("open_review_threads".to_string(), json!(open));
        }
        if let Some(open) = stats.open_document_threads {
            obj.insert("open_document_threads".to_string(), json!(open));
        }
        if let Some(runs) = stats.ci_runs {
            obj.insert("ci_runs".to_string(), json!(runs));
        }
        if let Some(error) = &stats.ci_error {
            obj.insert("ci_error".to_string(), json!(error));
        }
        /*
         * Who those threads are waiting on, so a portal can answer "does this
         * project want something from me" without a checkout of its own. The
         * id is the author record's — `oidc:<subject>` for a signed-in person,
         * which is what a portal can match against whoever is looking.
         *
         * Written only when the sync had sidecars to read, and then even when
         * the list is empty: on a repository with a conversation, "nobody is
         * waiting" is an answer, while on one that was never read it is a
         * guess.
         */
        if stats.open_document_threads.is_some() {
            obj.insert(
                "waiting_on".to_string(),
                json!(
                    waiting
                        .iter()
                        .map(|person| json!({
                            "id": person.id,
                            "name": person.name,
                            "threads": person.threads,
                        }))
                        .collect::<Vec<_>>()
                ),
            );
        }
    }
    node
}

pub fn issue_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    i: RemoteIssue,
) -> GtsNode {
    GtsNode {
        type_id: ISSUE_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "issue", &i.id]),
        value: json!({
            "repo": repo_id,
            "external_id": i.id,
            "number": i.number,
            "title": i.title,
            "state": i.state,
            "author": i.author,
            "body": i.body,
            "url": i.url,
            "labels": i.labels,
            "created_at": i.created_at,
            "updated_at": i.updated_at,
            "parent": i.parent.map(|r| json!({ "repo": r.repo, "number": r.number })),
            "iteration": i.iteration,
        }),
    }
}

pub fn file_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    f: RemoteFile,
) -> GtsNode {
    GtsNode {
        type_id: FILE_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "file", &f.path]),
        value: json!({
            "repo": repo_id,
            "path": f.path,
            "sha": f.sha,
            "is_dir": f.is_dir,
            "size": f.size,
        }),
    }
}

/// A File node built from a real checkout on disk: same identity as the
/// tree-API node (keyed on path, so the two channels upsert the same instance),
/// but carrying the snapshot `commit` and `from_checkout`.
///
/// Never the text, and no longer an excerpt of it beside the file either: the
/// text stays in the checkout, where everything that reads a document reads
/// it. A node an earlier sync wrote may still say `has_text`, which is how its
/// content node is found and retired.
///
/// `threads` is the conversation the repository carries about this file in
/// `.studio/comments/` (see [`super::comment_threads`]), and is `None` for a
/// file nobody has commented on. Absent rather than zero, for
/// `open_review_threads`'s reason: "no open threads" and "never commented on"
/// are different states, and a reader is entitled to tell them apart.
#[allow(clippy::too_many_arguments)]
pub fn file_node_cloned(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    path: &str,
    size: u64,
    commit: Option<&str>,
    threads: Option<ThreadCounts>,
) -> GtsNode {
    let mut node = GtsNode {
        type_id: FILE_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "file", path]),
        value: json!({
            "repo": repo_id,
            "path": path,
            "is_dir": false,
            "size": size,
            "commit": commit,
            "from_checkout": true,
        }),
    };
    if let (Some(counts), Some(obj)) = (threads, node.value.as_object_mut()) {
        obj.insert("open_threads".to_string(), json!(counts.open));
        obj.insert("resolved_threads".to_string(), json!(counts.resolved));
    }
    node
}

/// The instance id of a file's content node.
///
/// Derived from the file's own id, so whoever holds a file can name its
/// content without reading anything: the prune that forgets a file forgets
/// its content by this, and a re-sync upserts the same node.
pub fn file_content_instance_id(file_id: &str) -> String {
    anon_id(&[file_id, "content"])
}

/// The content node of `file`, or `None` when there is no text to search.
///
/// It carries `text`, which the graph backend bounds to a `text_excerpt` on
/// the way in (the ceiling lives with the store that has one), and enough of
/// the file to be read without it: `file` to map a search hit back, `path`
/// and `repo` to say which file it is. The scope fields are stamped on by the
/// batch that stamps the file's, so `node_in_scope` answers the same for both.
#[cfg(test)]
pub fn file_content_node(file: &GtsNode, text: &str) -> Option<GtsNode> {
    if text.trim().is_empty() {
        return None;
    }
    Some(GtsNode {
        type_id: FILE_CONTENT_TYPE,
        instance_id: file_content_instance_id(&file.instance_id),
        value: json!({
            "file": file.instance_id,
            "repo": file.value.get("repo"),
            "path": file.value.get("path"),
            "text": text,
        }),
    })
}

/// One pull request.
///
/// `review` is what the provider said about an OPEN pull request's review
/// conversations and reviewers, and `None` for one that is no longer open —
/// nothing is waiting on a merged branch — or when the provider could not say.
/// From it come `open_threads`, `reviews` (each reviewer's last word) and
/// `review_decision`; all three stay null without it, so a reader can tell
/// "nobody reviewed it" from "nobody knows".
///
/// `draft`, `requested_reviewers`, `requested_teams` and `assignees` come from
/// the listing itself. Added to `pull_request.v1` as optional fields: a node
/// a sync wrote before them reads as having none, and the type keeps its id
/// (ADR-0013 §5, "additive field").
pub fn pull_request_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    p: RemotePullRequest,
    review: Option<&PullRequestThreads>,
    links: &[Mention],
) -> GtsNode {
    let open_threads = review.map(|r| r.open);
    let reviews = review.map(|r| {
        r.reviews
            .iter()
            .map(|rv| json!({ "login": rv.login, "state": rv.state }))
            .collect::<Vec<_>>()
    });
    let review_decision = review.and_then(|r| {
        let stated: Vec<super::pull_request_waits::Review> = r
            .reviews
            .iter()
            .map(|rv| super::pull_request_waits::Review {
                login: rv.login.clone(),
                state: rv.state.clone(),
            })
            .collect();
        super::pull_request_waits::review_decision(
            &p.requested_reviewers,
            &p.requested_teams,
            &stated,
        )
    });
    GtsNode {
        type_id: PULL_REQUEST_TYPE,
        instance_id: anon_id(&[
            scope_key,
            connector_id,
            repo_full_path,
            "pull_request",
            &p.id,
        ]),
        value: json!({
            "repo": repo_id,
            "external_id": p.id,
            "number": p.number,
            "title": p.title,
            "state": p.state,
            "author": p.author,
            "body": p.body,
            "url": p.url,
            "source_branch": p.source_branch,
            "target_branch": p.target_branch,
            "merged": p.merged,
            "open_threads": open_threads,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
            "draft": p.draft,
            "requested_reviewers": p.requested_reviewers,
            "requested_teams": p.requested_teams,
            "assignees": p.assignees,
            "reviews": reviews,
            "review_decision": review_decision,
            "head_sha": p.head_sha,
            "merge_sha": p.merge_sha,
            "links": links
                .iter()
                .map(|m| json!({
                    "relation": m.relation.as_str(),
                    "repo": m.target.repo,
                    "number": m.target.number,
                }))
                .collect::<Vec<_>>(),
        }),
    }
}

/// pull_request → user: asked to review it, or reviewed it.
pub fn reviewed_by_edge(pr_id: &str, user_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_REVIEWED_BY,
        from: pr_id.to_string(),
        to: user_id.to_string(),
    }
}

/// pull_request → user: assigned to.
pub fn assigned_to_edge(pr_id: &str, user_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_ASSIGNED_TO,
        from: pr_id.to_string(),
        to: user_id.to_string(),
    }
}

/// A user node (issue/PR author). Keyed per source attachment and connection,
/// so the same login in two project graphs stays distinct. `title` mirrors the
/// login so the graph's node name is the handle.
pub fn user_node(scope_key: &str, connector_id: &str, provider: &str, login: &str) -> GtsNode {
    GtsNode {
        type_id: USER_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, "user", login]),
        value: json!({
            "provider": provider,
            "login": login,
            "title": login,
        }),
    }
}

/// A comment on an issue or pull request. `title` is a short snippet so the
/// graph node name is readable; `body` carries the full text.
pub fn comment_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    c: RemoteComment,
) -> GtsNode {
    let snippet = c.body.as_deref().map(|b| {
        let s: String = b.chars().take(80).collect();
        if b.chars().count() > 80 {
            format!("{s}…")
        } else {
            s
        }
    });
    GtsNode {
        type_id: COMMENT_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "comment", &c.id]),
        value: json!({
            "repo": repo_id,
            "external_id": c.id,
            "target_number": c.target_number,
            "author": c.author,
            "title": snippet,
            "body": c.body,
            "url": c.url,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }),
    }
}

/// A commit node. `title` is the first line of the message (the subject line).
pub fn commit_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    c: RemoteCommit,
) -> GtsNode {
    let subject = c
        .message
        .as_deref()
        .map(|m| m.lines().next().unwrap_or("").to_string());
    let short_sha: String = c.sha.chars().take(7).collect();
    GtsNode {
        type_id: COMMIT_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "commit", &c.sha]),
        value: json!({
            "repo": repo_id,
            "sha": c.sha,
            "short_sha": short_sha,
            "title": subject,
            "message": c.message,
            "author": c.author,
            "author_name": c.author_name,
            "url": c.url,
            "created_at": c.created_at,
        }),
    }
}

/// A CI run's node, keyed by the provider's run id: a re-run upserts over it.
/// `updated_at` orders the listing (`sort=updated`).
pub fn workflow_run_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    r: RemoteWorkflowRun,
) -> GtsNode {
    let short_sha: String = r.sha.chars().take(7).collect();
    let id = r.id.to_string();
    GtsNode {
        type_id: WORKFLOW_RUN_TYPE,
        instance_id: workflow_run_instance_id(scope_key, connector_id, repo_full_path, r.id),
        value: json!({
            "repo": repo_id,
            "external_id": id,
            "workflow": r.workflow,
            "workflow_path": r.workflow_path,
            "title": r.title,
            "event": r.event,
            "branch": r.branch,
            "sha": r.sha,
            "short_sha": short_sha,
            "status": r.status,
            "conclusion": r.conclusion,
            "author": r.actor,
            "url": r.url,
            "number": r.run_number,
            "attempt": r.attempt,
            "created_at": r.created_at,
            "started_at": r.started_at,
            "updated_at": r.updated_at,
        }),
    }
}

/// The id the sync gives a CI run's node: what an artifact names as its run.
pub fn workflow_run_instance_id(
    scope_key: &str,
    connector_id: &str,
    repo_full_path: &str,
    run_id: i64,
) -> String {
    anon_id(&[
        scope_key,
        connector_id,
        repo_full_path,
        "workflow_run",
        &run_id.to_string(),
    ])
}

/// A CI artifact's node, keyed by the provider's artifact id. `run` is the
/// node id of the run that kept it, so the listing hangs artifacts under
/// their build; `repo_full_path` is what a download is asked through.
pub fn build_artifact_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    a: RemoteBuildArtifact,
) -> GtsNode {
    let id = a.id.to_string();
    let run = a
        .run_id
        .map(|r| workflow_run_instance_id(scope_key, connector_id, repo_full_path, r));
    GtsNode {
        type_id: BUILD_ARTIFACT_TYPE,
        instance_id: anon_id(&[
            scope_key,
            connector_id,
            repo_full_path,
            "build_artifact",
            &id,
        ]),
        value: json!({
            "repo": repo_id,
            "repo_full_path": repo_full_path,
            "external_id": id,
            "title": a.name,
            "size_in_bytes": a.size_in_bytes,
            "expired": a.expired,
            "run": run,
            "run_external_id": a.run_id.map(|r| r.to_string()),
            "branch": a.branch,
            "sha": a.sha,
            "updated_at": a.created_at.clone(),
            "created_at": a.created_at,
            "expires_at": a.expires_at,
        }),
    }
}

/// A release's node, keyed by the provider's release id, with its assets in
/// the payload: they are only ever read with the release.
pub fn release_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    r: RemoteRelease,
) -> GtsNode {
    let id = r.id.to_string();
    let title = r.name.clone().unwrap_or_else(|| r.tag.clone());
    let assets: Vec<Value> = r
        .assets
        .into_iter()
        .map(|a| {
            json!({
                "id": a.id.to_string(),
                "name": a.name,
                "size": a.size,
                "content_type": a.content_type,
                "download_count": a.download_count,
            })
        })
        .collect();
    GtsNode {
        type_id: RELEASE_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "release", &id]),
        value: json!({
            "repo": repo_id,
            "repo_full_path": repo_full_path,
            "external_id": id,
            "title": title,
            "tag": r.tag,
            "draft": r.draft,
            "prerelease": r.prerelease,
            "url": r.url,
            "assets": assets,
            "updated_at": r.published_at.clone().or_else(|| r.created_at.clone()),
            "created_at": r.created_at,
            "published_at": r.published_at,
        }),
    }
}

/// A CI job's node, keyed by the provider's job id; `run` names the run's
/// node, and `attempt` the run attempt the job belongs to, so a re-run is
/// read again.
pub fn workflow_job_node(
    scope_key: &str,
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    run_node: &str,
    attempt: Option<i64>,
    j: RemoteWorkflowJob,
) -> GtsNode {
    let id = j.id.to_string();
    GtsNode {
        type_id: WORKFLOW_JOB_TYPE,
        instance_id: anon_id(&[scope_key, connector_id, repo_full_path, "workflow_job", &id]),
        value: json!({
            "repo": repo_id,
            "run": run_node,
            "attempt": attempt,
            "external_id": id,
            "title": j.name,
            "status": j.status,
            "conclusion": j.conclusion,
            "failed_step": j.failed_step,
            "started_at": j.started_at,
            "completed_at": j.completed_at,
            "url": j.url,
        }),
    }
}

/// A build's node id: one per reported build, so the report of its end lands
/// on the report of its start.
pub fn build_instance_id(project_id: &str, build_id: &str) -> String {
    anon_id(&["build", project_id, build_id])
}

/// A build the IDE reported, as the node keeps it. `value` is the record
/// [`super::service::IngestService::record_build`] assembled.
pub fn build_node(project_id: &str, build_id: &str, value: serde_json::Value) -> GtsNode {
    GtsNode {
        type_id: BUILD_TYPE,
        instance_id: build_instance_id(project_id, build_id),
        value,
    }
}

/// comment → issue / pull_request (the artifact the comment is on).
pub fn comment_on_edge(comment_id: &str, target_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_COMMENT_ON,
        from: comment_id.to_string(),
        to: target_id.to_string(),
    }
}

/// The instance id a File node has for `path` — so an edge can reference a file
/// without rebuilding its node (identity is keyed on path, same as `file_node`).
pub fn file_instance_id(
    scope_key: &str,
    connector_id: &str,
    repo_full_path: &str,
    path: &str,
) -> String {
    anon_id(&[scope_key, connector_id, repo_full_path, "file", path])
}

/// A user-uploaded or Studio-generated file node (no connector/repo). Bytes
/// remain in file-storage; this node carries hierarchy metadata and a durable
/// file/version reference. Repository-ingested file nodes use `file_node`
/// instead and never enter this path.
pub fn project_artifact_file_node(
    organization_id: &str,
    workspace_id: &str,
    project_id: &str,
    origin: &str,
    path: &str,
    size: u64,
    object_ref: Value,
) -> GtsNode {
    // A repeated upload of the same project/path creates a new immutable
    // file-storage version and updates this stable node's object_ref.
    GtsNode {
        type_id: FILE_TYPE,
        instance_id: anon_id(&[project_id, "project_artifact", path]),
        value: json!({
            "repo": project_id,
            "path": path,
            "is_dir": false,
            "size": size,
            "origin": origin,
            "organization_id": organization_id,
            "workspace_id": workspace_id,
            "project_id": project_id,
            "storage": "file-storage",
            "object_ref": object_ref,
            "has_text": false,
        }),
    }
}

/// issue / pull_request → repo.
pub fn artifact_of_edge(artifact_id: &str, repo_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_ARTIFACT_OF,
        from: artifact_id.to_string(),
        to: repo_id.to_string(),
    }
}

/// repo → file.
pub fn contains_edge(repo_id: &str, file_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_CONTAINS,
        from: repo_id.to_string(),
        to: file_id.to_string(),
    }
}

/// issue / pull_request → user (author).
pub fn authored_by_edge(artifact_id: &str, user_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_AUTHORED_BY,
        from: artifact_id.to_string(),
        to: user_id.to_string(),
    }
}

/// A link between two items found in their text or told by their provider:
/// [`REL_CLOSES`], [`REL_REFERENCES`] or [`REL_PART_OF`].
pub fn item_link_edge(type_id: &'static str, from: &str, to: &str) -> GtsEdge {
    GtsEdge {
        type_id,
        from: from.to_string(),
        to: to.to_string(),
    }
}

/// pull_request → file (a file it changed).
pub fn modifies_edge(pr_id: &str, file_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_MODIFIES,
        from: pr_id.to_string(),
        to: file_id.to_string(),
    }
}

// ── Spec-quality findings (materialized from detector results) ──

/// Deterministic finding instance id — idempotent per (detector, subject doc),
/// so re-running a detector upserts the same finding rather than duplicating.
pub fn spec_finding_instance_id(detector: &str, subject_id: &str) -> String {
    anon_id(&["spec_finding", detector, subject_id])
}

/// A spec-quality finding node about `subject_id` (a document node instance id).
/// `title` mirrors the summary so the graph node name reads as the verdict.
/// One detector's verdict on one document.
///
/// `recorded_at` is when this run produced it, not when the document changed.
/// The instance id is keyed on (detector, subject), so a re-run UPSERTS —
/// there is one finding per detector per document, and the timestamp is the
/// only thing that says how old the answer is. Without it a reader cannot
/// order two findings, tell a check from this morning from one from March, or
/// build a feed out of them at all.
#[allow(clippy::too_many_arguments)]
pub fn spec_finding_node(
    detector: &str,
    subject_id: &str,
    path: Option<&str>,
    severity: Option<&str>,
    summary: Option<&str>,
    score: Option<f64>,
    details: Value,
    recorded_at: &str,
) -> GtsNode {
    GtsNode {
        type_id: SPEC_FINDING_TYPE,
        instance_id: spec_finding_instance_id(detector, subject_id),
        value: json!({
            "detector": detector,
            "subject": subject_id,
            "path": path,
            "severity": severity,
            "title": summary,
            "summary": summary,
            "score": score,
            "details": details,
            "recorded_at": recorded_at,
        }),
    }
}

/// spec_finding → document (the document a finding is about).
pub fn finding_on_edge(finding_id: &str, subject_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_FINDING_ON,
        from: finding_id.to_string(),
        to: subject_id.to_string(),
    }
}

// ── Mapping decisions (cpt-studio-fr-mapping-decisions) ──

/// One decision per (document, section, capability, gear): deciding again
/// replaces it, and the payload says when and by whom.
pub fn mapping_decision_instance_id(
    document: &str,
    section: &str,
    capability: &str,
    gear: &str,
) -> String {
    anon_id(&["mapping_decision", document, section, capability, gear])
}

// ── Pilot records (HYP-3182) ──

/// One record per (matcher, Studio run): recording a run again replaces it.
// Nothing calls it until the pilot's writer does (HYP-3182).
#[cfg_attr(not(test), allow(dead_code))]
pub fn matcher_run_instance_id(matcher: &str, studio_run: &str) -> String {
    anon_id(&["matcher_run", matcher, studio_run])
}

/// One record per (matcher, Studio run, gear): choosing again replaces it.
// Nothing calls it until the pilot's writer does (HYP-3182).
#[cfg_attr(not(test), allow(dead_code))]
pub fn matcher_choice_instance_id(matcher: &str, studio_run: &str, gear: &str) -> String {
    anon_id(&["matcher_choice", matcher, studio_run, gear])
}

/// mapping_decision → document (the document whose capability it decides).
pub fn decision_on_edge(decision_id: &str, document_id: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_DECISION_ON,
        from: decision_id.to_string(),
        to: document_id.to_string(),
    }
}

/// document ↔ document (bloat near-duplicate). Endpoints are ordered so the pair
/// upserts once regardless of which direction the caller sends.
pub fn duplicates_edge(a: &str, b: &str) -> GtsEdge {
    let (from, to) = if a <= b { (a, b) } else { (b, a) };
    GtsEdge {
        type_id: REL_DUPLICATES,
        from: from.to_string(),
        to: to.to_string(),
    }
}

/// document → document (a traceability link).
pub fn traces_to_edge(from: &str, to: &str) -> GtsEdge {
    GtsEdge {
        type_id: REL_TRACES_TO,
        from: from.to_string(),
        to: to.to_string(),
    }
}

#[cfg(test)]
mod tests {

    /// The classification pass names the node the walk is about to store, and
    /// it computes that name through [`file_instance_id`] rather than by
    /// repeating the key. If the two ever disagree, every binding points at a
    /// node that does not exist — silently, because a binding keeps working
    /// and simply never matches anything in the graph.
    #[test]
    fn the_file_key_is_the_same_whoever_asks_for_it() {
        let node = file_node_cloned(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            "docs/adr/0007.md",
            42,
            Some("deadbeef"),
            None,
        );
        assert_eq!(
            node.instance_id,
            file_instance_id("scope", "connector", "acme/specs", "docs/adr/0007.md"),
        );
    }

    /// The pilot's records (HYP-3182): one per (matcher, run) and one per (matcher, run, gear),
    /// the same for both matchers, and listed by their own leaf, never among the mapping decisions.
    #[test]
    fn the_pilot_records_are_keyed_per_matcher_and_listed_apart_from_decisions() {
        assert_eq!(
            matcher_run_instance_id("verified", "run-1"),
            matcher_run_instance_id("verified", "run-1")
        );
        assert_ne!(
            matcher_run_instance_id("verified", "run-1"),
            matcher_run_instance_id("keyword", "run-1"),
            "the two matchers' records of one run are two records"
        );
        assert_ne!(
            matcher_choice_instance_id("verified", "run-1", "gears-rust/ledger"),
            matcher_choice_instance_id("verified", "run-1", "gears-rust/pricing")
        );
        assert_ne!(
            matcher_choice_instance_id("verified", "run-1", "gears-rust/ledger"),
            mapping_decision_instance_id("run-1", "", "", "gears-rust/ledger"),
        );
        assert_eq!(
            resolve_listable_types(Some("matcher_run")),
            vec![MATCHER_RUN_TYPE]
        );
        assert_eq!(
            resolve_listable_types(Some("matcher_choice")),
            vec![MATCHER_CHOICE_TYPE]
        );
        assert!(!resolve_listable_types(None).contains(&MATCHER_RUN_TYPE));
    }

    fn pull(state: &str) -> RemotePullRequest {
        RemotePullRequest {
            id: "70".into(),
            number: 7,
            title: "Add the thing".into(),
            state: state.into(),
            author: Some("alice".into()),
            draft: Some(false),
            requested_reviewers: vec!["carol".into()],
            requested_teams: vec!["Backend".into()],
            assignees: vec!["alice".into()],
            ..RemotePullRequest::default()
        }
    }

    /// An open pull request carries who owes a review, who reviewed and how,
    /// and the decision that amounts to.
    #[test]
    fn an_open_pull_request_carries_its_reviewers_and_their_decision() {
        let review = PullRequestThreads {
            number: 7,
            open: 1,
            total: 2,
            reviews: vec![crate::connectors::sdk::RemoteReview {
                login: "bob".into(),
                state: "approved".into(),
            }],
        };
        let node = pull_request_node(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            pull("open"),
            Some(&review),
            &[],
        );
        let v = &node.value;
        assert_eq!(v["draft"], json!(false));
        assert_eq!(v["requested_reviewers"], json!(["carol"]));
        assert_eq!(v["requested_teams"], json!(["Backend"]));
        assert_eq!(v["assignees"], json!(["alice"]));
        assert_eq!(
            v["reviews"],
            json!([{ "login": "bob", "state": "approved" }])
        );
        assert_eq!(v["review_decision"], json!("approved"));
        assert_eq!(v["open_threads"], json!(1));
    }

    /// Without the review read — a merged pull request, or a provider that
    /// could not answer — the review fields say nothing rather than "none".
    #[test]
    fn without_a_review_read_the_review_fields_are_null() {
        let node = pull_request_node(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            pull("merged"),
            None,
            &[],
        );
        let v = &node.value;
        assert_eq!(v["reviews"], Value::Null);
        assert_eq!(v["review_decision"], Value::Null);
        assert_eq!(v["open_threads"], Value::Null);
        // The listing's own fields are still there.
        assert_eq!(v["requested_reviewers"], json!(["carol"]));
    }

    /// A pull request keeps its commits and the items its text names, each
    /// with its repository when the text named one (ADR-0047 §3).
    #[test]
    fn a_pull_request_keeps_its_commits_and_what_it_names() {
        use crate::connectors::sdk::{NumberRef, Relation};
        let mut p = pull("merged");
        p.head_sha = Some("abc".into());
        p.merge_sha = Some("def".into());
        let links = [
            Mention {
                relation: Relation::Closes,
                target: NumberRef {
                    repo: None,
                    number: 3,
                },
            },
            Mention {
                relation: Relation::References,
                target: NumberRef {
                    repo: Some("o/r".into()),
                    number: 9,
                },
            },
        ];
        let node = pull_request_node(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            p,
            None,
            &links,
        );
        let v = &node.value;
        assert_eq!(v["head_sha"], "abc");
        assert_eq!(v["merge_sha"], "def");
        assert_eq!(
            v["links"],
            json!([
                { "relation": "closes", "repo": null, "number": 3 },
                { "relation": "references", "repo": "o/r", "number": 9 },
            ])
        );
    }

    /// A file nobody has commented on carries no thread keys at all, and one
    /// that has been carries both.
    ///
    /// Absent rather than zero, for `open_review_threads`'s reason: a reader
    /// has to be able to tell "this document's conversation is settled" from
    /// "this document has never been discussed", and a `0` that means either
    /// says neither.
    #[test]
    fn thread_counts_are_absent_until_there_are_threads() {
        let plain = file_node_cloned(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            "docs/prd.md",
            42,
            None,
            None,
        );
        assert!(plain.value.get("open_threads").is_none());
        assert!(plain.value.get("resolved_threads").is_none());

        let discussed = file_node_cloned(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            "docs/prd.md",
            42,
            None,
            Some(ThreadCounts {
                open: 0,
                resolved: 3,
            }),
        );
        assert_eq!(discussed.value.get("open_threads"), Some(&json!(0)));
        assert_eq!(discussed.value.get("resolved_threads"), Some(&json!(3)));
    }

    /// And the tree-API node keys on the same thing, so a repository ingested
    /// both ways is one node per file rather than two.
    #[test]
    fn the_tree_and_the_clone_agree_on_a_files_identity() {
        let from_tree = file_node(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            RemoteFile {
                path: "docs/adr/0007.md".to_string(),
                sha: "abc".to_string(),
                is_dir: false,
                size: Some(42),
            },
        );
        assert_eq!(
            from_tree.instance_id,
            file_instance_id("scope", "connector", "acme/specs", "docs/adr/0007.md"),
        );
    }

    use super::*;

    #[test]
    fn project_artifact_node_keeps_hierarchy_and_only_an_object_reference() {
        let object_ref = json!({
            "storage": "file-storage",
            "file_id": "0198af9a-77bc-7e01-b620-bb237979866b",
            "version_id": "0198af9a-77bc-7e01-b620-bb237979866c",
            "checksum": "sha256:abc123",
        });
        let node = project_artifact_file_node(
            "organization-1",
            "workspace-1",
            "project-1",
            "generated",
            "report.pdf",
            42,
            object_ref.clone(),
        );

        assert_eq!(node.value["organization_id"], "organization-1");
        assert_eq!(node.value["workspace_id"], "workspace-1");
        assert_eq!(node.value["project_id"], "project-1");
        assert_eq!(node.value["origin"], "generated");
        assert_eq!(node.value["storage"], "file-storage");
        assert_eq!(node.value["object_ref"], object_ref);
        assert!(node.value.get("text").is_none());
    }

    #[test]
    fn project_artifact_identity_is_stable_across_versions() {
        let first = project_artifact_file_node(
            "organization-1",
            "workspace-1",
            "project-1",
            "manual",
            "brief.md",
            1,
            json!({ "version_id": "version-1" }),
        );
        let second = project_artifact_file_node(
            "organization-1",
            "workspace-1",
            "project-1",
            "manual",
            "brief.md",
            2,
            json!({ "version_id": "version-2" }),
        );

        assert_eq!(first.instance_id, second.instance_id);
        assert_ne!(first.value["object_ref"], second.value["object_ref"]);
    }

    #[test]
    fn graph_type_ids_derive_from_a_family_and_round_trip() {
        let id = graph_type_id(FILE_TYPE);
        assert!(id.starts_with(OWNED_NODE_FAMILY), "{id}");
        assert!(id.ends_with("cf.studio.artifact.file.v1~"), "{id}");
        assert_eq!(our_type_from_graph(&id), Some(FILE_TYPE));
        assert!(graph_type_id(REL_CONTAINS).starts_with(STATIC_EDGE_FAMILY));
        assert_eq!(graph_node_type_schemas().len(), ALL_NODE_TYPES.len());
        assert_eq!(graph_edge_type_schemas().len(), ALL_EDGE_TYPES.len());
    }

    /// The file node is metadata only. The content node an earlier sync stored
    /// beside it names it, under an id anyone holding the file can compute,
    /// which is how a later sync retires it.
    #[test]
    fn a_files_text_is_its_content_node_not_its_own() {
        let file = file_node_cloned(
            "scope",
            "repo-id",
            "connector",
            "acme/specs",
            "docs/prd.md",
            42,
            Some("deadbeef"),
            None,
        );
        assert!(file.value.get("text").is_none());
        assert!(file.value.get("text_excerpt").is_none());
        assert!(file.value.get("has_text").is_none());
        assert_eq!(file.value["from_checkout"], true);

        let content = file_content_node(&file, "# PRD").expect("text has a content node");
        assert_eq!(content.type_id, FILE_CONTENT_TYPE);
        assert_eq!(
            content.instance_id,
            file_content_instance_id(&file.instance_id)
        );
        assert_ne!(content.instance_id, file.instance_id);
        assert_eq!(content.value["file"], file.instance_id.as_str());
        assert_eq!(content.value["path"], "docs/prd.md");
        assert_eq!(content.value["repo"], "repo-id");
        assert_eq!(content.value["text"], "# PRD");

        assert!(file_content_node(&file, "  \n").is_none());
    }

    /// graph-storage refuses a changed schema under a registered id, and one
    /// refusal fails the whole batch. The file type's traits are therefore
    /// frozen as they were registered, excerpt path and all; only the new
    /// content type declares the narrower pair.
    #[test]
    fn the_file_type_keeps_the_traits_it_was_registered_with() {
        let schemas = graph_node_type_schemas();
        let traits = |our: &str| {
            let id = format!("gts://{}", graph_type_id(our));
            schemas
                .iter()
                .find(|s| s["$id"] == id.as_str())
                .map(|s| s["x-gts-traits"].clone())
                .expect("the type is registered")
        };
        assert_eq!(
            traits(FILE_TYPE),
            json!({ "full_text_search": FULL_TEXT_PATHS, "vector_search": VECTOR_PATHS })
        );
        assert_eq!(
            traits(FILE_CONTENT_TYPE),
            json!({ "full_text_search": CONTENT_PATHS, "vector_search": CONTENT_PATHS })
        );
        assert!(graph_type_id(REL_CONTENT_OF).starts_with(STATIC_EDGE_FAMILY));
    }

    #[test]
    fn repository_identity_is_independent_per_project_attachment() {
        let first = repo_node("project-a", "github-connection", "github", "acme/example");
        let second = repo_node("project-b", "github-connection", "github", "acme/example");

        assert_ne!(first.instance_id, second.instance_id);
        assert_eq!(first.value["full_path"], second.value["full_path"]);
    }
}

#[cfg(test)]
mod listable_type_tests {
    use super::*;

    #[test]
    fn a_build_is_listable_by_its_leaf_and_keyed_by_project_and_build() {
        assert_eq!(resolve_listable_types(Some("build")), vec![BUILD_TYPE]);
        assert!(!resolve_listable_types(None).contains(&BUILD_TYPE));
        let a = build_node("p1", "b1", json!({"status": "running"}));
        let b = build_node("p1", "b1", json!({"status": "passed"}));
        assert_eq!(a.instance_id, b.instance_id, "the end lands on the start");
        assert_ne!(a.instance_id, build_node("p2", "b1", json!({})).instance_id);
        assert_eq!(a.type_id, BUILD_TYPE);
    }

    #[test]
    fn a_workflow_run_is_listable_by_its_leaf_and_keyed_by_run_not_attempt() {
        assert_eq!(
            resolve_listable_types(Some("workflow_run")),
            vec![WORKFLOW_RUN_TYPE]
        );
        assert!(!resolve_listable_types(None).contains(&WORKFLOW_RUN_TYPE));
        let run = |attempt| RemoteWorkflowRun {
            id: 7,
            workflow: "CI".into(),
            sha: "abcdef123".into(),
            attempt: Some(attempt),
            conclusion: Some("failure".into()),
            ..Default::default()
        };
        let a = workflow_run_node("t", "repo-id", "c", "o/r", run(1));
        let b = workflow_run_node("t", "repo-id", "c", "o/r", run(2));
        assert_eq!(
            a.instance_id, b.instance_id,
            "a re-run upserts over its run"
        );
        assert_eq!(a.type_id, WORKFLOW_RUN_TYPE);
        assert_eq!(b.value["attempt"], 2);
        assert_eq!(a.value["short_sha"], "abcdef1");
        assert_eq!(a.value["repo"], "repo-id");
        assert_eq!(a.value["conclusion"], "failure");
    }

    #[test]
    fn a_build_artifact_names_its_run_by_the_runs_own_node_id() {
        assert_eq!(
            resolve_listable_types(Some("build_artifact")),
            vec![BUILD_ARTIFACT_TYPE]
        );
        let run = workflow_run_node(
            "t",
            "repo-id",
            "c",
            "o/r",
            RemoteWorkflowRun {
                id: 7,
                sha: "abc".into(),
                ..Default::default()
            },
        );
        let artifact = build_artifact_node(
            "t",
            "repo-id",
            "c",
            "o/r",
            RemoteBuildArtifact {
                id: 70,
                name: "dist".into(),
                run_id: Some(7),
                ..Default::default()
            },
        );
        assert_eq!(artifact.type_id, BUILD_ARTIFACT_TYPE);
        assert_eq!(artifact.value["run"], run.instance_id.as_str());
        assert_eq!(artifact.value["title"], "dist");
        assert_eq!(artifact.value["repo_full_path"], "o/r");
        let orphan = build_artifact_node(
            "t",
            "repo-id",
            "c",
            "o/r",
            RemoteBuildArtifact {
                id: 71,
                ..Default::default()
            },
        );
        assert!(orphan.value["run"].is_null());
    }

    #[test]
    fn a_release_is_titled_by_its_name_else_its_tag_and_carries_its_assets() {
        let r = |name: Option<&str>| RemoteRelease {
            id: 3,
            tag: "v1.0.0".into(),
            name: name.map(str::to_string),
            assets: vec![crate::connectors::sdk::RemoteReleaseAsset {
                id: 30,
                name: "app.zip".into(),
                size: Some(10),
                ..Default::default()
            }],
            ..Default::default()
        };
        let named = release_node("t", "repo-id", "c", "o/r", r(Some("First")));
        let bare = release_node("t", "repo-id", "c", "o/r", r(None));
        assert_eq!(named.type_id, RELEASE_TYPE);
        assert_eq!(named.value["title"], "First");
        assert_eq!(bare.value["title"], "v1.0.0");
        assert_eq!(named.instance_id, bare.instance_id);
        assert_eq!(named.value["assets"][0]["id"], "30");
        assert_eq!(named.value["assets"][0]["name"], "app.zip");
    }

    #[test]
    fn a_workflow_job_names_its_run_and_attempt_and_is_keyed_by_job() {
        assert_eq!(
            resolve_listable_types(Some("workflow_job")),
            vec![WORKFLOW_JOB_TYPE]
        );
        let job = |id| RemoteWorkflowJob {
            id,
            name: "test-backend".into(),
            conclusion: Some("failure".into()),
            failed_step: Some("cargo test".into()),
            ..Default::default()
        };
        let a = workflow_job_node("t", "repo-id", "c", "o/r", "run-node", Some(2), job(9));
        let b = workflow_job_node("t", "repo-id", "c", "o/r", "run-node", Some(2), job(10));
        assert_ne!(a.instance_id, b.instance_id, "one node per job");
        assert_eq!(a.type_id, WORKFLOW_JOB_TYPE);
        assert_eq!(a.value["run"], "run-node");
        assert_eq!(a.value["attempt"], 2);
        assert_eq!(a.value["title"], "test-backend");
        assert_eq!(a.value["failed_step"], "cargo test");
    }

    #[test]
    fn default_lists_only_the_four_first_class_artifacts() {
        let t = resolve_listable_types(None);
        assert_eq!(
            t.len(),
            4,
            "default listing should expose exactly four types"
        );
        for want in [REPO_TYPE, FILE_TYPE, ISSUE_TYPE, PULL_REQUEST_TYPE] {
            assert!(t.contains(&want), "missing default type {want}");
        }
        assert!(
            !t.contains(&USER_TYPE),
            "user is graph detail, not listed by default"
        );
        assert!(
            !t.contains(&COMMIT_TYPE),
            "commit is graph detail, not listed by default"
        );
    }

    #[test]
    fn type_filter_matches_full_gts_id_and_bare_leaf() {
        assert_eq!(resolve_listable_types(Some(ISSUE_TYPE)), vec![ISSUE_TYPE]);
        assert_eq!(resolve_listable_types(Some("issue")), vec![ISSUE_TYPE]);
        assert_eq!(
            resolve_listable_types(Some(PULL_REQUEST_TYPE)),
            vec![PULL_REQUEST_TYPE]
        );
        assert_eq!(
            resolve_listable_types(Some("pull_request")),
            vec![PULL_REQUEST_TYPE]
        );
        assert!(
            resolve_listable_types(Some("does_not_exist")).is_empty(),
            "an unknown type lists nothing, not everything"
        );
    }
}
