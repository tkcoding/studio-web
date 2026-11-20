//! The artifact graph kept as domain objects (ADR-0066 §8a, the target
//! scheme): `gears.studio-artifact-ingest.config.storage.artifacts: model`.
//!
//! What a sync writes — repositories, issues, pull requests, files, commits,
//! comments, CI runs, builds, releases, findings — becomes objects of the
//! domain model's types (`repository`, `work-item`, `pull-request`,
//! `repository-file`, `commit`, `comment`, `ci-run`, …) and its relations
//! become declared relations, so `POST /query` reads them like anything else
//! the model holds, and an administrator can extend them. The gear keeps no
//! store of its own: every [`GraphStore`] call is answered from the model.
//!
//! The payload is kept verbatim, so what a listing returns is what it
//! returned before. An object's id is the artifact's id with a prefix
//! ([`ID_PREFIX`]): the artifact's own node still holds that key in the graph
//! until a purge, and two nodes cannot share one.
//!
//! What a tenant already had moves once, in the background, by the model
//! sweep ([`ArtifactMover`], as this gear's service identity): every node and
//! relation the old store lists is written into the model, and a marker
//! object records that it is done. Until then reads are answered by the old
//! store and writes go to both, so nothing a sync writes during the move is
//! lost. Relations the old store does not list come back with the next sync
//! of their repository.
//!
//! A request never starts the move. It used to: on Dev (2026-11-12), after
//! the start-up sweep's move timed out, every artifact read asked the model
//! for the marker and started the move again (failing then on the caller's
//! context, #1080), 1124 times in 25 minutes (#1077). Whatever the context,
//! a move lists the tenant's whole old store, which is no work for a request
//! or for every read after a failure. A read only asks whether the tenant has
//! moved, and remembers "not yet" for [`NOT_MOVED_FOR`]; the sweep moves it,
//! and retries a failed move with a back-off.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde_json::{Value, json};
use toolkit_security::SecurityContext;
use tracing::{info, warn};
use uuid::Uuid;

use super::graph::{
    GraphStore, GtsEdge, GtsEdgeView, GtsNode, NodePage, NodePageQuery, PageStart, ingested_file,
    page_of_nodes,
};
use super::gts;
use super::port::IngestedFile;
use crate::domain_model::port::{DomainObjects, OwnedObject, StoredObject, TypeNeed};

/// Where the artifact graph is kept (`config.storage.artifacts`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactStorage {
    /// Domain objects: the target scheme, and the default.
    #[default]
    Model,
    /// The gear's own graph types, as before.
    Graph,
}

/// What an artifact's id gets in front of it as a domain object's id.
pub const ID_PREFIX: &str = "art-";

/// The marker that a tenant's artifacts have moved.
const MOVED_MARKER: &str = "art-store-moved-v1";

/// How long a read takes "not moved yet" (or a marker it could not read) for
/// an answer before asking the model again. A move this process makes is
/// known at once; another replica's, after this long.
const NOT_MOVED_FOR: std::time::Duration = std::time::Duration::from_secs(60);

/// The wait before the sweep tries a failed move again: doubled after each
/// failure, up to [`MOVE_RETRY_MAX`]. A move lists the tenant's whole old
/// store, so it is not repeated every period under the load that failed it.
const MOVE_RETRY_FIRST: std::time::Duration = std::time::Duration::from_secs(300);
const MOVE_RETRY_MAX: std::time::Duration = std::time::Duration::from_secs(3600);

/// Each artifact type and the model type it becomes.
const KINDS: [(&str, &str); 17] = [
    (gts::REPO_TYPE, "repository"),
    (gts::ISSUE_TYPE, "work-item"),
    (gts::PULL_REQUEST_TYPE, "pull-request"),
    (gts::FILE_TYPE, "repository-file"),
    (gts::USER_TYPE, "source-account"),
    (gts::SPEC_FINDING_TYPE, "finding"),
    (gts::COMMENT_TYPE, "comment"),
    (gts::COMMIT_TYPE, "commit"),
    (gts::FILE_CONTENT_TYPE, "text-content"),
    (gts::MAPPING_DECISION_TYPE, "mapping-decision"),
    (gts::MATCHER_RUN_TYPE, "matcher-run"),
    (gts::MATCHER_CHOICE_TYPE, "matcher-choice"),
    (gts::WORKFLOW_RUN_TYPE, "ci-run"),
    (gts::WORKFLOW_JOB_TYPE, "ci-job"),
    (gts::BUILD_TYPE, "product-build"),
    (gts::BUILD_ARTIFACT_TYPE, "build-artifact"),
    (gts::RELEASE_TYPE, "release"),
];

/// Each artifact relation and the declared relation it becomes (declared on
/// `system-object`, so it holds between objects of any type).
const RELATIONS: [(&str, &str, &str, &str); 15] = [
    (
        gts::REL_ARTIFACT_OF,
        "in_repository",
        "repository",
        "references",
    ),
    (
        gts::REL_CONTAINS,
        "contains_file",
        "repository-file",
        "composes",
    ),
    (
        gts::REL_AUTHORED_BY,
        "authored_by_account",
        "source-account",
        "references",
    ),
    (
        gts::REL_MODIFIES,
        "modifies_file",
        "repository-file",
        "references",
    ),
    (
        gts::REL_DUPLICATES,
        "duplicates",
        "system-object",
        "references",
    ),
    (
        gts::REL_TRACES_TO,
        "traces_to",
        "system-object",
        "references",
    ),
    (
        gts::REL_FINDING_ON,
        "finding_on",
        "system-object",
        "references",
    ),
    (
        gts::REL_COMMENT_ON,
        "comment_on",
        "system-object",
        "references",
    ),
    (
        gts::REL_CONTENT_OF,
        "content_of",
        "repository-file",
        "references",
    ),
    (
        gts::REL_DECISION_ON,
        "decision_on",
        "system-object",
        "references",
    ),
    (
        gts::REL_REVIEWED_BY,
        "reviewed_by_account",
        "source-account",
        "references",
    ),
    (
        gts::REL_ASSIGNED_TO,
        "assigned_to_account",
        "source-account",
        "references",
    ),
    (gts::REL_CLOSES, "closes_item", "work-item", "references"),
    (
        gts::REL_REFERENCES,
        "mentions",
        "system-object",
        "references",
    ),
    (gts::REL_PART_OF, "part_of_item", "work-item", "references"),
];

const RELATION_SOURCE: &str = "system-object";

fn entity_of(artifact_type: &str) -> Option<&'static str> {
    KINDS
        .iter()
        .find(|(a, _)| *a == artifact_type)
        .map(|(_, e)| *e)
}

fn artifact_of_entity(entity: &str) -> Option<&'static str> {
    KINDS.iter().find(|(_, e)| *e == entity).map(|(a, _)| *a)
}

fn object_id(artifact_id: &str) -> String {
    format!("{ID_PREFIX}{artifact_id}")
}

fn artifact_id(object_id: &str) -> String {
    object_id
        .strip_prefix(ID_PREFIX)
        .unwrap_or(object_id)
        .to_string()
}

/// The tenant an artifact belongs to: its project, else its workspace.
fn scope_of(value: &Value) -> String {
    ["project_id", "workspace_id"]
        .iter()
        .find_map(|k| value.get(*k).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

/// The fields every artifact type needs in the model to be queried the way
/// the listings narrow (scope, repository, order).
fn common_fields() -> Vec<(String, String, String)> {
    [
        (
            "workspace_id",
            "string",
            "The workspace the artifact belongs to",
        ),
        (
            "project_id",
            "string",
            "The project the artifact belongs to",
        ),
        ("repo", "string", "The repository the artifact came from"),
        ("path", "string", "Its path in the repository"),
        ("title", "string", "What it is called"),
        ("updated_at", "timestamp", "When the source last changed it"),
        ("url", "url", "Where it is in the source system"),
    ]
    .into_iter()
    .map(|(n, t, d)| (n.to_string(), t.to_string(), d.to_string()))
    .collect()
}

/// The gear that keeps the synced types (`TypeNeed::held_by`).
const GEAR: &str = "studio-artifact-ingest";

/// Kinds members also write themselves, left open to the generic writes.
const SHARED_KINDS: [&str; 3] = ["work-item", "comment", "finding"];

/// The types and relations the model needs before the first write.
pub(super) fn needs() -> Vec<TypeNeed> {
    let new_type = |id: &str, name: &str, description: &str| TypeNeed {
        declared_by: GEAR.to_owned(),
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        extends: Some("record".to_string()),
        bucket: Some("content".to_string()),
        fields: common_fields(),
        relations: Vec::new(),
        held_by: Some(GEAR.to_string()),
        searchable: true,
    };
    let mut out: Vec<TypeNeed> = vec![
        new_type(
            "source-account",
            "Source Account",
            "An account in a source system: who wrote or reviewed something there.",
        ),
        new_type(
            "mapping-decision",
            "Mapping Decision",
            "A member's decision on which gear covers a capability a document declares.",
        ),
        new_type(
            "ci-run",
            "CI Run",
            "One run of one CI workflow on one commit.",
        ),
        new_type("ci-job", "CI Job", "One job of a CI run's latest attempt."),
        new_type(
            "product-build",
            "Product Build",
            "A build of the project's product the IDE ran and reported.",
        ),
        new_type(
            "build-artifact",
            "Build Artifact",
            "A file a CI run uploaded.",
        ),
        new_type(
            "release",
            "Release",
            "A release of a repository: a tag and the files attached to it.",
        ),
    ];
    for (_, entity) in KINDS {
        if out.iter().any(|n| n.id == entity) {
            continue;
        }
        out.push(TypeNeed {
            declared_by: GEAR.to_owned(),
            id: entity.to_string(),
            fields: common_fields(),
            // What a sync writes is the source's, and the next sync would
            // overwrite an edit: those types are this gear's. Work items,
            // comments and findings are also what members write themselves.
            held_by: (!SHARED_KINDS.contains(&entity)).then(|| GEAR.to_string()),
            // Found by meaning: the artifact search runs over them.
            searchable: true,
            ..Default::default()
        });
    }
    out.push(TypeNeed {
        declared_by: GEAR.to_owned(),
        id: RELATION_SOURCE.to_string(),
        relations: RELATIONS
            .iter()
            .map(|(_, name, target, verb)| (name.to_string(), target.to_string(), verb.to_string()))
            .collect(),
        ..Default::default()
    });
    out
}

/// The artifact graph, answered from the domain model.
pub struct ModelGraphStore {
    /// The store the gear used before: answers until a tenant has moved.
    legacy: Arc<dyn GraphStore>,
    hub: Arc<toolkit::client_hub::ClientHub>,
    typed: Mutex<HashSet<Uuid>>,
    moved: Mutex<HashSet<Uuid>>,
    moving: Mutex<HashSet<Uuid>>,
    /// When a read last found a tenant not moved (or could not tell).
    not_moved: Mutex<HashMap<Uuid, std::time::Instant>>,
    /// A tenant whose move failed: how many times, and when it may run again.
    failed: Mutex<HashMap<Uuid, (u32, std::time::Instant)>>,
    /// How many moves have been started (tests: a read starts none).
    #[cfg(test)]
    moves_started: std::sync::atomic::AtomicUsize,
}

impl ModelGraphStore {
    pub fn new(legacy: Arc<dyn GraphStore>, hub: Arc<toolkit::client_hub::ClientHub>) -> Self {
        Self {
            legacy,
            hub,
            typed: Mutex::default(),
            moved: Mutex::default(),
            moving: Mutex::default(),
            not_moved: Mutex::default(),
            failed: Mutex::default(),
            #[cfg(test)]
            moves_started: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn port(&self) -> anyhow::Result<Arc<dyn DomainObjects>> {
        self.hub
            .get::<dyn DomainObjects>()
            .map(crate::domain_model::port::KeptByGear::wrap)
            .map_err(|e| anyhow::anyhow!("the domain model is not available: {e}"))
    }

    async fn ensure_types(
        &self,
        ctx: &SecurityContext,
        port: &dyn DomainObjects,
    ) -> anyhow::Result<()> {
        let tenant = ctx.subject_tenant_id();
        if self
            .typed
            .lock()
            .map(|t| t.contains(&tenant))
            .unwrap_or(false)
        {
            return Ok(());
        }
        for need in needs() {
            port.ensure_type(ctx, &need).await?;
        }
        if let Ok(mut t) = self.typed.lock() {
            t.insert(tenant);
        }
        Ok(())
    }

    fn is_moved(&self, tenant: Uuid) -> bool {
        self.moved
            .lock()
            .map(|m| m.contains(&tenant))
            .unwrap_or(false)
    }

    /// Whether the model's marker says this tenant has moved. `Err` when it
    /// could not be read: not the same as absent.
    async fn marked(&self, ctx: &SecurityContext) -> anyhow::Result<bool> {
        let port = self.port()?;
        let (rows, _) = port
            .query(
                ctx,
                json!({"type": "sync-state", "where": {"id": {"_eq": MOVED_MARKER}}, "limit": 1}),
            )
            .await?;
        Ok(rows
            .first()
            .is_some_and(|o| o.payload.get("status").and_then(Value::as_str) != Some("returned")))
    }

    /// Has this tenant moved? What a read or a write asks. Never starts the
    /// move: that is the sweep's ([`Self::make_ready`]). A tenant found moved
    /// is remembered for the process; one found not moved, or whose marker
    /// could not be read, for [`NOT_MOVED_FOR`], so a busy screen does not
    /// ask the model on every read.
    async fn ready(&self, ctx: &SecurityContext) -> bool {
        let tenant = ctx.subject_tenant_id();
        if self.is_moved(tenant) {
            return true;
        }
        let asked_lately = self
            .not_moved
            .lock()
            .ok()
            .and_then(|m| m.get(&tenant).copied())
            .is_some_and(|at| at.elapsed() < NOT_MOVED_FOR);
        if asked_lately {
            return false;
        }
        // A marker that could not be read is not a marker that is absent:
        // this read answers from the old store, as for "not yet".
        let marked = match self.marked(ctx).await {
            Ok(marked) => marked,
            Err(e) => {
                warn!(error = %format!("{e:#}"), "studio-artifact-ingest: the move marker could not be read; reads stay on the old store");
                false
            }
        };
        if marked {
            if let Ok(mut m) = self.moved.lock() {
                m.insert(tenant);
            }
            return true;
        }
        if let Ok(mut m) = self.not_moved.lock() {
            m.insert(tenant, std::time::Instant::now());
        }
        false
    }

    /// Move this tenant's artifacts into the model if they have not moved:
    /// the sweep's step, as this gear's service identity in the tenant
    /// (`ctx`), which may declare the model's types. Waits for the move.
    /// `Ok(true)` once moved; `Ok(false)` when the move is not tried now
    /// (another is running, or a failed one waits for its retry).
    pub(super) async fn make_ready(&self, ctx: &SecurityContext) -> anyhow::Result<bool> {
        let tenant = ctx.subject_tenant_id();
        if self.is_moved(tenant) {
            return Ok(true);
        }
        let waiting = self
            .failed
            .lock()
            .ok()
            .and_then(|f| f.get(&tenant).copied())
            .is_some_and(|(_, not_before)| std::time::Instant::now() < not_before);
        if waiting {
            return Ok(false);
        }
        // An unreadable marker is not an absent one: no move on it.
        if self.marked(ctx).await? {
            if let Ok(mut m) = self.moved.lock() {
                m.insert(tenant);
            }
            return Ok(true);
        }
        let claimed = self
            .moving
            .lock()
            .map(|mut m| m.insert(tenant))
            .unwrap_or(false);
        if !claimed {
            return Ok(false);
        }
        #[cfg(test)]
        self.moves_started
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let result = self.move_tenant(ctx).await;
        if let Ok(mut m) = self.moving.lock() {
            m.remove(&tenant);
        }
        match result {
            Ok(()) => {
                if let Ok(mut m) = self.moved.lock() {
                    m.insert(tenant);
                }
                if let Ok(mut f) = self.failed.lock() {
                    f.remove(&tenant);
                }
                Ok(true)
            }
            Err(e) => {
                let mut retry_in = MOVE_RETRY_FIRST;
                if let Ok(mut f) = self.failed.lock() {
                    let failures = f.get(&tenant).map_or(0, |(n, _)| *n).saturating_add(1);
                    retry_in = MOVE_RETRY_FIRST
                        .saturating_mul(1u32 << failures.saturating_sub(1).min(4))
                        .min(MOVE_RETRY_MAX);
                    f.insert(tenant, (failures, std::time::Instant::now() + retry_in));
                }
                warn!(error = %format!("{e:#}"), %tenant, retry_in_s = retry_in.as_secs(), "studio-artifact-ingest: moving the artifacts into the domain model failed — reads stay on the old store until the sweep moves them");
                Err(e)
            }
        }
    }

    async fn move_tenant(&self, ctx: &SecurityContext) -> anyhow::Result<()> {
        let port = self.port()?;
        self.ensure_types(ctx, port.as_ref()).await?;
        // Asked before the walk, not learnt from the first write after it: a
        // refused move used to read the whole old store first (10 000+ nodes
        // on Dev), fail, and do it again at every retry.
        self.may_move(ctx, port.as_ref()).await?;
        let mut moved: Vec<GtsNode> = Vec::new();
        for (artifact_type, _) in KINDS {
            let found = self.legacy.list(ctx, Some(artifact_type)).await?;
            self.write_nodes(ctx, port.as_ref(), &found).await?;
            moved.extend(found.iter().cloned());
        }
        let nodes = moved.len();
        let edges: Vec<GtsEdge> = self
            .legacy
            .list_relations(ctx)
            .await?
            .into_iter()
            .filter_map(|e| {
                let type_id = RELATIONS.iter().find(|(r, ..)| *r == e.type_id)?.0;
                Some(GtsEdge {
                    type_id,
                    from: e.from,
                    to: e.to,
                })
            })
            .collect();
        let (linked, skipped) = self.write_edges(ctx, port.as_ref(), &edges).await?;
        port.put_objects(
            ctx,
            "sync-state",
            vec![OwnedObject {
                id: MOVED_MARKER.to_string(),
                scope: String::new(),
                payload: json!({"status": "done", "message": "artifacts moved into the domain model"}),
            }],
        )
        .await?;
        // The model holds them now: the old store's copies go, so nothing is
        // kept twice (the graph nodes and the artifact index mirror). A failure
        // here leaves a copy nobody reads, not a loss.
        for chunk in moved.chunks(500) {
            if let Err(e) = self.legacy.delete_nodes(ctx, chunk).await {
                warn!(error = %e, "studio-artifact-ingest: the old store's copies could not all be removed");
                break;
            }
        }
        info!(
            nodes,
            relations = linked,
            skipped,
            "studio-artifact-ingest: artifacts moved into the domain model"
        );
        Ok(())
    }

    /// May this caller write what the move writes? Every model type an
    /// artifact becomes and the marker, organization-wide: the grant the
    /// sweep's identity needs in the tenant. A refusal names the subject, the
    /// type and the owner (`check_put`), so the cause is in the log.
    async fn may_move(
        &self,
        ctx: &SecurityContext,
        port: &dyn DomainObjects,
    ) -> anyhow::Result<()> {
        let org = [String::new()];
        let mut entities: Vec<&str> = KINDS.iter().map(|(_, entity)| *entity).collect();
        entities.push("sync-state");
        entities.sort_unstable();
        entities.dedup();
        for entity in entities {
            if let Err(e) = port.check_put(ctx, entity, &org).await {
                warn!(
                    tenant = %ctx.subject_tenant_id(),
                    subject = %ctx.subject_id(),
                    entity,
                    error = %format!("{e:#}"),
                    "studio-artifact-ingest: the move into the domain model is refused before reading the old store"
                );
                return Err(e.context(format!(
                    "the artifact move may not write `{entity}` objects in this tenant; the old store was not read"
                )));
            }
        }
        Ok(())
    }

    async fn write_nodes(
        &self,
        ctx: &SecurityContext,
        port: &dyn DomainObjects,
        nodes: &[GtsNode],
    ) -> anyhow::Result<()> {
        let mut by_entity: HashMap<&'static str, Vec<OwnedObject>> = HashMap::new();
        for n in nodes {
            let Some(entity) = entity_of(n.type_id) else {
                warn!(
                    type_id = n.type_id,
                    "studio-artifact-ingest: no model type for this artifact type — not stored"
                );
                continue;
            };
            by_entity.entry(entity).or_default().push(OwnedObject {
                id: object_id(&n.instance_id),
                scope: scope_of(&n.value),
                // What the graph kept is what the model keeps: file content
                // as a bounded excerpt, the whole under the per-object
                // ceiling graph-storage enforces (64 KiB).
                payload: bounded_payload(&n.value),
            });
        }
        for (entity, objects) in by_entity {
            port.put_objects(ctx, entity, objects).await?;
        }
        Ok(())
    }

    async fn write_edges(
        &self,
        ctx: &SecurityContext,
        port: &dyn DomainObjects,
        edges: &[GtsEdge],
    ) -> anyhow::Result<(usize, usize)> {
        let links: Vec<(String, String, String, String)> = edges
            .iter()
            .filter_map(|e| {
                let name = RELATIONS.iter().find(|(r, ..)| *r == e.type_id)?.1;
                Some((
                    RELATION_SOURCE.to_string(),
                    name.to_string(),
                    object_id(&e.from),
                    object_id(&e.to),
                ))
            })
            .collect();
        port.link_objects(ctx, links).await
    }

    fn to_node(artifact_type: &'static str, o: StoredObject) -> GtsNode {
        let mut value = o.payload;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("_scope");
        }
        GtsNode {
            type_id: artifact_type,
            instance_id: artifact_id(&o.instance_id),
            value,
        }
    }

    /// The objects of the listable types `type_filter` names, narrowed by
    /// `where_`.
    async fn read(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        where_: Option<Value>,
    ) -> anyhow::Result<Vec<GtsNode>> {
        let answers = self
            .query_types(ctx, type_filter, |entity| {
                let mut body = json!({"type": entity});
                if let Some(w) = &where_ {
                    body["where"] = w.clone();
                }
                body
            })
            .await?;
        Ok(answers
            .into_iter()
            .flat_map(|(_, nodes, _)| nodes)
            .collect())
    }

    /// One query per listable type `type_filter` names, all at once: each is
    /// its own access check and read-model query, and the default listing
    /// names four types, which one after another cost four round trips.
    /// Answers each type's nodes and its total, in the types' order.
    async fn query_types(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        body_of: impl Fn(&str) -> Value,
    ) -> anyhow::Result<Vec<(&'static str, Vec<GtsNode>, usize)>> {
        let port = self.port()?;
        let reads = gts::resolve_listable_types(type_filter)
            .into_iter()
            .filter_map(|t| entity_of(t).map(|e| (t, e)))
            .map(|(artifact_type, entity)| {
                let port = Arc::clone(&port);
                let body = body_of(entity);
                async move {
                    let (rows, total) = port.query(ctx, body).await?;
                    let nodes: Vec<GtsNode> = rows
                        .into_iter()
                        .map(|o| Self::to_node(artifact_type, o))
                        .collect();
                    anyhow::Ok((artifact_type, nodes, total))
                }
            });
        futures_util::future::try_join_all(reads).await
    }

    /// One page of a scope's artifacts, narrowed, ordered and sliced by the
    /// model, so a page of 50 reads 50 rows and a count instead of every
    /// artifact of the scope (a synced project holds thousands of files).
    ///
    /// The same rules as [`page_of_nodes`]: newest `updated_at` first with
    /// ties by id, else by id, an absent date last. The model breaks ties by
    /// object id, which is the artifact id behind one shared prefix, so the
    /// order is the same. Over several types each answers the first
    /// `offset + limit` of its own, and the page is cut from their merge.
    async fn page_in_model(
        &self,
        ctx: &SecurityContext,
        scope: &str,
        q: &NodePageQuery<'_>,
        offset: usize,
    ) -> anyhow::Result<NodePage> {
        let types = gts::resolve_listable_types(q.type_filter);
        let single = types.len() == 1;
        let mut where_ = scope_where(scope);
        if let Some(repo) = q.repo {
            where_["repo"] = json!({"_eq": repo});
        }
        let order = if q.by_updated {
            json!([{"field": "updated_at", "direction": "desc"}])
        } else {
            json!([])
        };
        let answers = self
            .query_types(ctx, q.type_filter, |entity| {
                let mut body = json!({"type": entity, "where": where_, "order_by": order});
                if single {
                    body["offset"] = json!(offset);
                    body["limit"] = json!(q.limit);
                } else {
                    body["limit"] = json!(offset.saturating_add(q.limit));
                }
                body
            })
            .await?;
        let total: usize = answers.iter().map(|(_, _, n)| *n).sum();
        let start = offset.min(total);
        let mut nodes: Vec<GtsNode> = answers.into_iter().flat_map(|(_, n, _)| n).collect();
        if !single {
            sort_as_listed(&mut nodes, q.by_updated);
            nodes = nodes.into_iter().skip(start).take(q.limit).collect();
        }
        nodes.truncate(q.limit);
        Ok(NodePage {
            nodes,
            total: u64::try_from(total).unwrap_or(u64::MAX),
            start: u64::try_from(start).unwrap_or(u64::MAX),
        })
    }
}

/// The artifacts whose payload names `scope` as their workspace or project.
fn scope_where(scope: &str) -> Value {
    json!({"_or": [{"workspace_id": {"_eq": scope}}, {"project_id": {"_eq": scope}}]})
}

/// [`scope_where`] for any of several projects.
///
/// Sent with `project_ids`, which narrows by the indexed `scope` column
/// first: an artifact's scope is its project, else its workspace
/// ([`scope_of`]), so every artifact naming one of these projects is in
/// it, and so is one whose workspace field names it without a project. What
/// the column leaves out is an artifact whose workspace field names one of
/// these projects while its project field names another: a project is never
/// a workspace, so no sync writes one.
fn projects_where(projects: &[String]) -> Value {
    json!({"_or": [{"workspace_id": {"_in": projects}}, {"project_id": {"_in": projects}}]})
}

/// The listing's order ([`page_of_nodes`]): newest `updated_at` first, an
/// absent one last, ties by id; or by id alone.
fn sort_as_listed(nodes: &mut [GtsNode], by_updated: bool) {
    if by_updated {
        fn updated(n: &GtsNode) -> &str {
            n.value
                .get("updated_at")
                .and_then(Value::as_str)
                .unwrap_or("")
        }
        nodes.sort_by(|a, b| {
            updated(b)
                .cmp(updated(a))
                .then_with(|| a.instance_id.cmp(&b.instance_id))
        });
    } else {
        nodes.sort_by(|a, b| a.instance_id.cmp(&b.instance_id));
    }
}

/// The store the service holds: an `Arc` so the background move can keep it.
pub struct ModelGraph(pub Arc<ModelGraphStore>);

#[async_trait]
impl GraphStore for ModelGraph {
    async fn upsert_nodes(&self, ctx: &SecurityContext, nodes: &[GtsNode]) -> anyhow::Result<()> {
        let s = &self.0;
        let ready = s.ready(ctx).await;
        let port = s.port()?;
        s.ensure_types(ctx, port.as_ref()).await?;
        s.write_nodes(ctx, port.as_ref(), nodes).await?;
        if !ready {
            s.legacy.upsert_nodes(ctx, nodes).await?;
        }
        Ok(())
    }

    async fn upsert_edges(&self, ctx: &SecurityContext, edges: &[GtsEdge]) -> anyhow::Result<()> {
        let s = &self.0;
        let ready = s.ready(ctx).await;
        let port = s.port()?;
        s.ensure_types(ctx, port.as_ref()).await?;
        s.write_edges(ctx, port.as_ref(), edges).await?;
        if !ready {
            s.legacy.upsert_edges(ctx, edges).await?;
        }
        Ok(())
    }

    async fn delete_nodes(
        &self,
        ctx: &SecurityContext,
        nodes: &[GtsNode],
    ) -> anyhow::Result<usize> {
        let s = &self.0;
        let ready = s.ready(ctx).await;
        let port = s.port()?;
        let mut by_entity: HashMap<&'static str, Vec<String>> = HashMap::new();
        for n in nodes {
            if let Some(entity) = entity_of(n.type_id) {
                by_entity
                    .entry(entity)
                    .or_default()
                    .push(object_id(&n.instance_id));
            }
        }
        let mut removed = 0;
        for (entity, ids) in by_entity {
            removed += port.remove_objects(ctx, entity, ids).await?;
        }
        if !ready {
            return s.legacy.delete_nodes(ctx, nodes).await;
        }
        Ok(removed)
    }

    async fn search(
        &self,
        ctx: &SecurityContext,
        text: &str,
        limit: u32,
    ) -> anyhow::Result<Vec<GtsNode>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.search(ctx, text, limit).await;
        }
        let port = s.port()?;
        let entities: Vec<&str> = KINDS.iter().map(|(_, e)| *e).collect();
        let hits = port.search(ctx, text, &entities, limit).await?;
        let mut out: Vec<GtsNode> = hits
            .into_iter()
            .filter_map(|(type_id, o)| {
                let leaf = type_id
                    .trim_end_matches('~')
                    .trim_end_matches(".v1")
                    .rsplit('.')
                    .next()
                    .unwrap_or_default()
                    .replace('_', "-");
                let artifact_type = artifact_of_entity(&leaf)?;
                Some(ModelGraphStore::to_node(artifact_type, o))
            })
            .collect();
        // A hit on a file's text answers as the file, as the old store did.
        let content: Vec<String> = out
            .iter()
            .filter(|n| n.type_id == gts::FILE_CONTENT_TYPE)
            .filter_map(|n| {
                n.value
                    .get("file")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect();
        out.retain(|n| n.type_id != gts::FILE_CONTENT_TYPE);
        if !content.is_empty() {
            let have: HashSet<String> = out.iter().map(|n| n.instance_id.clone()).collect();
            let wanted: Vec<Value> = content
                .iter()
                .filter(|id| !have.contains(*id))
                .map(|id| Value::String(object_id(id)))
                .collect();
            if !wanted.is_empty() {
                let (rows, _) = port
                    .query(
                        ctx,
                        json!({"type": "repository-file", "where": {"id": {"_in": wanted}}}),
                    )
                    .await?;
                out.extend(
                    rows.into_iter()
                        .map(|o| ModelGraphStore::to_node(gts::FILE_TYPE, o)),
                );
            }
        }
        out.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        Ok(out)
    }

    async fn list(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
    ) -> anyhow::Result<Arc<Vec<GtsNode>>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.list(ctx, type_filter).await;
        }
        Ok(Arc::new(s.read(ctx, type_filter, None).await?))
    }

    async fn list_relations(&self, ctx: &SecurityContext) -> anyhow::Result<Vec<GtsEdgeView>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.list_relations(ctx).await;
        }
        let names: Vec<&str> = RELATIONS.iter().map(|(_, n, ..)| *n).collect();
        let port = s.port()?;
        Ok(port
            .relations(ctx, &names)
            .await?
            .into_iter()
            .filter_map(|(name, from, to)| {
                let type_id = RELATIONS.iter().find(|(_, n, ..)| *n == name)?.0;
                Some(GtsEdgeView {
                    type_id: type_id.to_string(),
                    from: artifact_id(&from),
                    to: artifact_id(&to),
                })
            })
            .collect())
    }

    fn stored_payload(&self, value: &Value) -> Value {
        bounded_payload(value)
    }

    async fn list_in_scope(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<Vec<GtsNode>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.list_in_scope(ctx, type_filter, scope).await;
        }
        s.read(ctx, type_filter, Some(scope_where(scope))).await
    }

    async fn count_in_scope(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<u64> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.count_in_scope(ctx, type_filter, scope).await;
        }
        // The model counts; one row each is all that is read.
        let answers = s
            .query_types(
                ctx,
                type_filter,
                |entity| json!({"type": entity, "where": scope_where(scope), "limit": 1}),
            )
            .await?;
        let n: usize = answers.iter().map(|(_, _, n)| *n).sum();
        Ok(u64::try_from(n).unwrap_or(u64::MAX))
    }

    async fn list_in_projects(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        projects: &[String],
    ) -> anyhow::Result<HashMap<String, Vec<GtsNode>>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.list_in_projects(ctx, type_filter, projects).await;
        }
        // One query per type for every project, by the indexed `scope`
        // column, then split here by the same rule `scope_where` asks.
        let answers = s
            .query_types(ctx, type_filter, |entity| {
                json!({"type": entity, "project_ids": projects, "where": projects_where(projects)})
            })
            .await?;
        let mut out: HashMap<String, Vec<GtsNode>> =
            projects.iter().map(|p| (p.clone(), Vec::new())).collect();
        for node in answers.into_iter().flat_map(|(_, nodes, _)| nodes) {
            for p in projects {
                if super::rest::node_in_scope(&node.value, Some(p))
                    && let Some(list) = out.get_mut(p)
                {
                    list.push(node.clone());
                }
            }
        }
        Ok(out)
    }

    async fn count_in_projects(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        projects: &[String],
    ) -> anyhow::Result<HashMap<String, u64>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.count_in_projects(ctx, type_filter, projects).await;
        }
        let port = s.port()?;
        // One `GROUP BY` per type for every project: no row is read.
        let reads = gts::resolve_listable_types(type_filter)
            .into_iter()
            .filter_map(entity_of)
            .map(|entity| {
                let port = Arc::clone(&port);
                let body = json!({
                    "type": entity,
                    "project_ids": projects,
                    "where": projects_where(projects),
                    "aggregate": {"group_by": ["project_id", "workspace_id"]},
                    "limit": 0,
                });
                async move { port.aggregate(ctx, body).await }
            });
        let mut out: HashMap<String, u64> = projects.iter().map(|p| (p.clone(), 0)).collect();
        for (groups, _) in futures_util::future::try_join_all(reads).await? {
            for (key, count) in groups {
                let names = |i: usize, p: &str| key.get(i).and_then(Value::as_str) == Some(p);
                for p in projects {
                    // The same rule as `scope_where`: its project or its
                    // workspace, counted once when it is both.
                    if (names(0, p) || names(1, p))
                        && let Some(n) = out.get_mut(p)
                    {
                        *n = n.saturating_add(count);
                    }
                }
            }
        }
        Ok(out)
    }

    async fn files_in_scope(
        &self,
        ctx: &SecurityContext,
        scope: &str,
    ) -> anyhow::Result<Vec<IngestedFile>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            // The old store's own file read: the index reads three columns.
            return s.legacy.files_in_scope(ctx, scope).await;
        }
        Ok(self
            .list_in_scope(ctx, Some(gts::FILE_TYPE), scope)
            .await?
            .iter()
            .filter_map(ingested_file)
            .collect())
    }

    async fn repos_of_files(
        &self,
        ctx: &SecurityContext,
        scope: &str,
        node_ids: &[String],
    ) -> anyhow::Result<HashMap<String, String>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.repos_of_files(ctx, scope, node_ids).await;
        }
        super::graph::repos_of_listed_files(self, ctx, scope, node_ids).await
    }

    async fn repo_activity(
        &self,
        ctx: &SecurityContext,
        scope: &str,
        now: i64,
        days: usize,
    ) -> anyhow::Result<std::collections::BTreeMap<String, super::activity::RepoActivity>> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.repo_activity(ctx, scope, now, days).await;
        }
        // The model's types do not declare the fields the window is on
        // (`created_at` of a commit, `merged` of a pull request), so it
        // cannot count them: both are read, side by side.
        super::graph::activity_of_listing(self, ctx, scope, now, days).await
    }

    async fn page(
        &self,
        ctx: &SecurityContext,
        query: &NodePageQuery<'_>,
    ) -> anyhow::Result<NodePage> {
        let s = &self.0;
        if !s.ready(ctx).await {
            return s.legacy.page(ctx, query).await;
        }
        // `subject` is no field of the model's types, and the text search
        // spans fields the model does not index: those pages are still cut
        // here, as is a page after a cursor (an id, not a position).
        if let (Some(scope), None, None, PageStart::Offset(offset)) =
            (query.scope, query.subject, query.needle, query.start)
        {
            match s.page_in_model(ctx, scope, query, offset).await {
                Ok(page) => return Ok(page),
                // A model whose types lack a field the page orders by
                // still answers, the slow way.
                Err(e) => {
                    warn!(error = %format!("{e:#}"), "studio-artifact-ingest: the model could not cut the page; reading the scope whole");
                }
            }
        }
        let nodes = match query.scope {
            Some(scope) => self.list_in_scope(ctx, query.type_filter, scope).await?,
            None => s.read(ctx, query.type_filter, None).await?,
        };
        Ok(page_of_nodes(&nodes, query))
    }
}

#[cfg(test)]
#[path = "model_store_tests.rs"]
mod tests;

/// The artifact graph kept in the old store again (`storage.artifacts:
/// graph`), with what the model holds moved back on a tenant's first touch:
/// the switch is never one-way, and nothing is kept twice. Synced artifacts
/// would come back with the next sync anyway; members' mapping decisions and
/// the IDE's builds would not.
pub struct ReturningGraph(pub Arc<ModelGraphStore>);

impl ModelGraphStore {
    async fn back_to_graph(&self, ctx: &SecurityContext) {
        let tenant = ctx.subject_tenant_id();
        if self
            .moved
            .lock()
            .map(|m| m.contains(&tenant))
            .unwrap_or(true)
        {
            return;
        }
        let Ok(port) = self.port() else {
            return;
        };
        let p = port.as_ref();
        let result = async {
            let (marked, _) = p
                .query(ctx, json!({"type": "sync-state", "where": {"id": {"_eq": MOVED_MARKER}}, "limit": 1}))
                .await?;
            if !marked
                .first()
                .is_some_and(|o| o.payload.get("status").and_then(Value::as_str) != Some("returned"))
            {
                return anyhow::Ok(0usize);
            }
            let nodes = self.read(ctx, None, None).await?;
            let names: Vec<&str> = RELATIONS.iter().map(|(_, n, ..)| *n).collect();
            let edges: Vec<GtsEdge> = p
                .relations(ctx, &names)
                .await?
                .into_iter()
                .filter_map(|(name, from, to)| {
                    let type_id = RELATIONS.iter().find(|(_, n, ..)| *n == name)?.0;
                    Some(GtsEdge { type_id, from: artifact_id(&from), to: artifact_id(&to) })
                })
                .collect();
            self.legacy.upsert_nodes(ctx, &nodes).await?;
            self.legacy.upsert_edges(ctx, &edges).await?;
            let mut by_entity: HashMap<&'static str, Vec<String>> = HashMap::new();
            for n in &nodes {
                if let Some(entity) = entity_of(n.type_id) {
                    by_entity.entry(entity).or_default().push(object_id(&n.instance_id));
                }
            }
            for (entity, ids) in by_entity {
                for chunk in ids.chunks(500) {
                    p.remove_objects(ctx, entity, chunk.to_vec()).await?;
                }
            }
            p.put_objects(
                ctx,
                "sync-state",
                vec![OwnedObject {
                    id: MOVED_MARKER.to_string(),
                    scope: String::new(),
                    payload: json!({"status": "returned", "message": "artifacts moved back to the graph store"}),
                }],
            )
            .await?;
            anyhow::Ok(nodes.len())
        }
        .await;
        match result {
            Ok(n) => {
                if n > 0 {
                    info!(
                        nodes = n,
                        "studio-artifact-ingest: artifacts moved back to the graph store"
                    );
                }
                if let Ok(mut m) = self.moved.lock() {
                    m.insert(tenant);
                }
            }
            Err(e) => {
                warn!(error = %e, "studio-artifact-ingest: artifacts could not move back yet")
            }
        }
    }
}

#[async_trait]
impl GraphStore for ReturningGraph {
    async fn upsert_nodes(&self, ctx: &SecurityContext, nodes: &[GtsNode]) -> anyhow::Result<()> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.upsert_nodes(ctx, nodes).await
    }
    async fn upsert_edges(&self, ctx: &SecurityContext, edges: &[GtsEdge]) -> anyhow::Result<()> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.upsert_edges(ctx, edges).await
    }
    async fn delete_nodes(
        &self,
        ctx: &SecurityContext,
        nodes: &[GtsNode],
    ) -> anyhow::Result<usize> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.delete_nodes(ctx, nodes).await
    }
    async fn search(
        &self,
        ctx: &SecurityContext,
        text: &str,
        limit: u32,
    ) -> anyhow::Result<Vec<GtsNode>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.search(ctx, text, limit).await
    }
    async fn list(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
    ) -> anyhow::Result<Arc<Vec<GtsNode>>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.list(ctx, type_filter).await
    }
    async fn list_relations(&self, ctx: &SecurityContext) -> anyhow::Result<Vec<GtsEdgeView>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.list_relations(ctx).await
    }
    fn stored_payload(&self, value: &Value) -> Value {
        self.0.legacy.stored_payload(value)
    }
    async fn list_in_scope(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<Vec<GtsNode>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.list_in_scope(ctx, type_filter, scope).await
    }
    async fn count_in_scope(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
        scope: &str,
    ) -> anyhow::Result<u64> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.count_in_scope(ctx, type_filter, scope).await
    }
    async fn files_in_scope(
        &self,
        ctx: &SecurityContext,
        scope: &str,
    ) -> anyhow::Result<Vec<IngestedFile>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.files_in_scope(ctx, scope).await
    }
    async fn repos_of_files(
        &self,
        ctx: &SecurityContext,
        scope: &str,
        node_ids: &[String],
    ) -> anyhow::Result<HashMap<String, String>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.repos_of_files(ctx, scope, node_ids).await
    }
    async fn repo_activity(
        &self,
        ctx: &SecurityContext,
        scope: &str,
        now: i64,
        days: usize,
    ) -> anyhow::Result<std::collections::BTreeMap<String, super::activity::RepoActivity>> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.repo_activity(ctx, scope, now, days).await
    }
    async fn page(
        &self,
        ctx: &SecurityContext,
        query: &NodePageQuery<'_>,
    ) -> anyhow::Result<NodePage> {
        self.0.back_to_graph(ctx).await;
        self.0.legacy.page(ctx, query).await
    }
}

/// The artifact store's part in the start-up sweep: per organization.
pub struct ArtifactMover {
    pub store: Arc<ModelGraphStore>,
    pub returning: bool,
}

#[async_trait]
impl crate::model_sweep::TenantMover for ArtifactMover {
    fn name(&self) -> &str {
        "studio-artifact-ingest"
    }
    async fn prepare(&self, ctx: &SecurityContext, tenant: Uuid) -> anyhow::Result<()> {
        if tenant != ctx.subject_tenant_id() {
            return Ok(());
        }
        if self.returning {
            self.store.back_to_graph(ctx).await;
        } else {
            // The one place the move runs: a request never starts it.
            self.store.make_ready(ctx).await?;
        }
        Ok(())
    }
    /// Again every period: a move that failed (a deadline under the load of
    /// a start) is retried here, with its back-off, not by requests.
    fn periodic(&self) -> bool {
        !self.returning
    }
}

/// What the graph keeps of a node's payload (`graph_backend`); a build
/// without graph-storage has no graph to bound it for.
#[cfg(feature = "graph")]
fn bounded_payload(value: &Value) -> Value {
    super::graph_backend::bounded_payload(value)
}

#[cfg(not(feature = "graph"))]
fn bounded_payload(value: &Value) -> Value {
    value.clone()
}
