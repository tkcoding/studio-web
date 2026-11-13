//! A project created as one durable background run (`organizations.project_create`,
//! studio-tasks), resumable step by step.
//!
//! The portal used to make the steps one request at a time from the browser
//! (the prototype's `buildCreatePlan` in `App.tsx`, the FrontX portal's
//! `wizardEffects.ts`): the project tenant, its configuration, the repository
//! its gears go to, its sources, a starter gear, a PRD from the brief, the
//! kits it asked for. A closed tab or a failed request left half a project,
//! and an agent could not create one at all.
//!
//! **On whose behalf.** A run executes with no request behind it, so it
//! cannot carry the caller's token (`cpt-studio-principle-tasks-authorize-at-enqueue`).
//! Everything is therefore decided when the run is asked for, as the caller,
//! through the checks the individual routes apply (`project_create_rest.rs`):
//! the caller reaches the workspace, every connection is one they can see and
//! the organization owns, no connection is personal. The approved plan --
//! with `asked_by` -- is the run's payload. Each step then executes in
//! process as this gear's service principal ([`super::logo::SERVICE_SUBJECT_ID`]),
//! scoped to the organization the project is created in (the tenant, the
//! repository through the organization's connection, the PRD) or to the new
//! project tenant (its configuration and kits), never wider. The design is
//! `docs/design/studio-organizations.md`, "Creating a project".
//!
//! **Resumable.** Each finished step is recorded in the run's result (its
//! progress detail) and the run reads it back on the next attempt or after
//! `POST /studio-tasks/v1/runs/{id}/retry`; every step also checks what is
//! already there before it writes (the tenant by its pre-chosen id, the
//! configuration by its fields, the sources by their URL, the PRD by its type,
//! the kits by slug), so a record lost with a crash costs a probe, not a
//! duplicate.

use std::sync::Arc;

use account_management_sdk::{AccountManagementClient, CreateTenantRequest, UpsertMetadataRequest};
use async_trait::async_trait;
use gts::GtsTypeId;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use toolkit::client_hub::ClientHub;
use toolkit_canonical_errors::CanonicalError;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use crate::tasks::sdk::{TaskContext, TaskHandler, TaskOutcome};

/// The task type, a wire contract: runs queued under it outlive a rename.
pub const TASK_TYPE: &str = "organizations.project_create";

/// The tenant type a project is.
const PROJECT_TENANT_TYPE: &str = super::sdk::PROJECT_TENANT_TYPE;

/// One repository picked as a source, with the tenant holding its connection
/// (checked at enqueue: the organization's own, not personal).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourcePick {
    pub connection_id: Uuid,
    pub holder: Uuid,
    /// `owner/name`.
    pub full_path: String,
    pub clone_url: String,
    #[serde(default)]
    pub branch: Option<String>,
}

/// The repository the project's gears go to: made, or one that exists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepositoryPlan {
    pub connection_id: Uuid,
    pub holder: Uuid,
    /// `new` or `existing`.
    pub mode: String,
    /// For `new`: its name, the account it goes under, whether that is an
    /// organization, and whether it is private.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub is_org: bool,
    #[serde(default)]
    pub private: bool,
    /// For `existing`.
    #[serde(default)]
    pub full_path: Option<String>,
    #[serde(default)]
    pub clone_url: Option<String>,
    #[serde(default)]
    pub default_branch: Option<String>,
}

/// A starter gear written into the repository (`POST /projects/{id}/scaffold`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScaffoldPlan {
    pub slug: String,
    #[serde(default)]
    pub app_title: Option<String>,
    #[serde(default)]
    pub problem: Option<String>,
    #[serde(default)]
    pub parent_dir: Option<String>,
    #[serde(default)]
    pub gear_kind: Option<String>,
    #[serde(default)]
    pub plugin_host: Option<String>,
    #[serde(default)]
    pub plugin_spec: Option<String>,
    #[serde(default)]
    pub open_pr: bool,
}

/// The PRD written from the brief: the answer to its first question.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrdPlan {
    pub title: String,
    pub answer: String,
}

/// A kit the project asks for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KitPick {
    pub slug: String,
    #[serde(default)]
    pub version: Option<String>,
}

/// What was approved when the run was asked for: the run's payload.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    /// Who asked. Recorded as the PRD's author; the steps act as the service.
    pub asked_by: Uuid,
    pub organization_id: Uuid,
    pub workspace_id: Uuid,
    /// Chosen when the run was asked for, so a repeated step finds the tenant.
    pub project_id: Uuid,
    pub name: String,
    /// The fields `project.config` starts with (`mode`, `brief`, `owner_id`,
    /// `stages`, `status`, `type`).
    pub config: Map<String, Value>,
    #[serde(default)]
    pub sources: Vec<SourcePick>,
    #[serde(default)]
    pub repository: Option<RepositoryPlan>,
    #[serde(default)]
    pub scaffold: Option<ScaffoldPlan>,
    #[serde(default)]
    pub prd: Option<PrdPlan>,
    #[serde(default)]
    pub kits: Vec<KitPick>,
}

/// The steps a plan takes, in order.
pub fn steps_of(plan: &Plan) -> Vec<&'static str> {
    let mut out = vec!["tenant", "config"];
    if plan.repository.is_some() {
        out.push("repository");
    }
    if !plan.sources.is_empty() || plan.repository.is_some() {
        out.push("sources");
    }
    if plan.scaffold.is_some() {
        out.push("scaffold");
    }
    if plan.prd.is_some() {
        out.push("prd");
    }
    if !plan.kits.is_empty() {
        out.push("kits");
    }
    out
}

/// What one step is, as recorded.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepRecord {
    pub key: String,
    /// `pending`, `done` or `failed`.
    pub state: String,
    #[serde(default)]
    pub detail: Option<String>,
}

/// The repository the repository step made or attached, for the steps after it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MadeRepo {
    pub full_name: String,
    pub clone_url: String,
    pub default_branch: String,
    pub connection_id: Uuid,
    pub holder: Uuid,
}

/// The run's record: its result while it runs and when it ends.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub project_id: Uuid,
    pub organization_id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub asked_by: Uuid,
    pub steps: Vec<StepRecord>,
    #[serde(default)]
    pub repository: Option<MadeRepo>,
}

impl Record {
    /// A plan's record before any step ran, or what a run recorded before
    /// this attempt (another plan's record is not this run's: started over).
    pub fn resume(plan: &Plan, recorded: Option<&Value>) -> Self {
        let fresh = || Record {
            project_id: plan.project_id,
            organization_id: plan.organization_id,
            workspace_id: plan.workspace_id,
            name: plan.name.clone(),
            asked_by: plan.asked_by,
            steps: steps_of(plan)
                .into_iter()
                .map(|k| StepRecord {
                    key: k.to_string(),
                    state: "pending".to_string(),
                    detail: None,
                })
                .collect(),
            repository: None,
        };
        let Some(old) = recorded
            .and_then(|v| serde_json::from_value::<Record>(v.clone()).ok())
            .filter(|r| r.project_id == plan.project_id)
        else {
            return fresh();
        };
        let mut out = fresh();
        for step in &mut out.steps {
            if let Some(was) = old
                .steps
                .iter()
                .find(|s| s.key == step.key && s.state == "done")
            {
                step.clone_from(was);
            }
        }
        out.repository = old.repository;
        out
    }

    fn done(&self, key: &str) -> bool {
        self.steps.iter().any(|s| s.key == key && s.state == "done")
    }

    fn set(&mut self, key: &str, state: &str, detail: String) {
        if let Some(s) = self.steps.iter_mut().find(|s| s.key == key) {
            s.state = state.to_string();
            s.detail = Some(detail);
        }
    }
}

/// Why a step stopped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepError {
    /// Might work on the next attempt: a provider or a gear that is down.
    Retry(String),
    /// Will not work without a person: the plan cannot be carried out.
    Fail(String),
}

impl StepError {
    fn text(&self) -> &str {
        match self {
            StepError::Retry(t) | StepError::Fail(t) => t,
        }
    }
}

/// The steps themselves, behind a trait so the order and the record are
/// tested without account-management, a provider or the other gears.
#[async_trait]
pub trait Steps: Send + Sync {
    async fn tenant(&self, plan: &Plan) -> Result<String, StepError>;
    async fn config(&self, plan: &Plan) -> Result<String, StepError>;
    async fn repository(&self, plan: &Plan) -> Result<MadeRepo, StepError>;
    async fn sources(&self, plan: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError>;
    async fn scaffold(&self, plan: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError>;
    async fn prd(&self, plan: &Plan) -> Result<String, StepError>;
    async fn kits(&self, plan: &Plan) -> Result<String, StepError>;
}

/// Carry out what the record has not done yet, in order, recording each
/// step as it ends (`report`). Stops at the first step that does not end.
pub async fn run(
    plan: &Plan,
    mut record: Record,
    steps: &dyn Steps,
    report: &mut (dyn FnMut(&str, &Record) + Send),
) -> (Record, Result<(), StepError>) {
    let keys: Vec<String> = record.steps.iter().map(|s| s.key.clone()).collect();
    for key in keys {
        if record.done(&key) {
            continue;
        }
        report(&key, &record);
        let ended = match key.as_str() {
            "tenant" => steps.tenant(plan).await,
            "config" => steps.config(plan).await,
            "repository" => match steps.repository(plan).await {
                Ok(made) => {
                    let line = format!("{} on {}", made.full_name, made.default_branch);
                    record.repository = Some(made);
                    Ok(line)
                }
                Err(e) => Err(e),
            },
            "sources" => steps.sources(plan, record.repository.as_ref()).await,
            "scaffold" => steps.scaffold(plan, record.repository.as_ref()).await,
            "prd" => steps.prd(plan).await,
            "kits" => steps.kits(plan).await,
            other => Err(StepError::Fail(format!("no step `{other}`"))),
        };
        match ended {
            Ok(line) => {
                record.set(&key, "done", line);
                report(&key, &record);
            }
            Err(e) => {
                record.set(&key, "failed", e.text().to_string());
                return (record, Err(e));
            }
        }
    }
    (record, Ok(()))
}

/// What a step reads its own phase line as.
fn phase(key: &str) -> &'static str {
    match key {
        "tenant" => "Creating the project tenant",
        "config" => "Writing the project's configuration",
        "repository" => "Making the repository",
        "sources" => "Adding the repositories to the project's sources",
        "scaffold" => "Writing the starter gear",
        "prd" => "Writing the PRD from the brief",
        "kits" => "Asking for the kits",
        _ => "Working",
    }
}

/// This gear's service principal, scoped to `tenant` only.
fn service_ctx(tenant: Uuid) -> Result<SecurityContext, StepError> {
    SecurityContext::builder()
        .subject_id(super::logo::SERVICE_SUBJECT_ID)
        .subject_type("service")
        .subject_tenant_id(tenant)
        .token_scopes(vec!["*".to_owned()])
        .build()
        .map_err(|e| StepError::Fail(format!("cannot build the service context: {e}")))
}

fn retry(what: &str, e: impl std::fmt::Display) -> StepError {
    StepError::Retry(format!("{what}: {e}"))
}

/// Two spellings of one repository URL are one source.
fn same_repository(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.trim()
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_lowercase()
    };
    norm(a) == norm(b)
}

/// `config` with the plan's sources (and the made repository) added, each
/// once; whether anything was added.
pub fn add_sources(config: &mut Value, picks: &[SourcePick], repo: Option<&MadeRepo>) -> bool {
    if !config.is_object() {
        *config = Value::Object(Map::new());
    }
    let Some(map) = config.as_object_mut() else {
        return false;
    };
    let mut list = map
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut wanted: Vec<Value> = picks
        .iter()
        .map(|p| {
            let mut s = json!({
                "connection_id": p.connection_id,
                "full_path": p.full_path,
                "clone_url": p.clone_url,
            });
            if let Some(b) = p.branch.as_deref().filter(|b| !b.is_empty()) {
                s["branch"] = json!(b);
            }
            s
        })
        .collect();
    if let Some(r) = repo {
        wanted.push(json!({
            "connection_id": r.connection_id,
            "full_path": r.full_name,
            "clone_url": r.clone_url,
            "branch": r.default_branch,
            "gears_here": true,
        }));
    }
    let mut changed = false;
    for w in wanted {
        let url = w["clone_url"].as_str().unwrap_or_default().to_string();
        let path = w["full_path"].as_str().unwrap_or_default().to_lowercase();
        let known = list.iter().any(|s| {
            s.get("clone_url")
                .and_then(Value::as_str)
                .is_some_and(|u| same_repository(u, &url))
                || s.get("full_path")
                    .and_then(Value::as_str)
                    .is_some_and(|f| f.to_lowercase() == path)
        });
        if !known {
            list.push(w);
            changed = true;
        }
    }
    if changed {
        if !map.contains_key("source_git_url")
            && let Some(first) = list
                .first()
                .and_then(|s| s.get("clone_url"))
                .and_then(Value::as_str)
        {
            map.insert("source_git_url".to_string(), json!(first));
        }
        map.insert("sources".to_string(), Value::Array(list));
    }
    changed
}

/// `config` with the plan's fields set; a status already there is kept (a
/// retried run never moves a project back to its first status).
pub fn with_fields(config: &mut Value, fields: &Map<String, Value>) -> bool {
    if !config.is_object() {
        *config = Value::Object(Map::new());
    }
    let Some(map) = config.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for (k, v) in fields {
        if k == "status" && map.contains_key("status") {
            continue;
        }
        if map.get(k) != Some(v) {
            map.insert(k.clone(), v.clone());
            changed = true;
        }
    }
    changed
}

/// The steps, in this process, as the service.
pub struct InProcess {
    am: Arc<dyn AccountManagementClient>,
    hub: Arc<ClientHub>,
}

impl InProcess {
    pub fn new(am: Arc<dyn AccountManagementClient>, hub: Arc<ClientHub>) -> Self {
        Self { am, hub }
    }

    /// Change the project's configuration as the service scoped to the
    /// project, version-checked; a project with none yet gets one.
    async fn change_config(
        &self,
        project: Uuid,
        mut change: impl FnMut(&mut Value) -> bool + Send,
    ) -> Result<bool, StepError> {
        let ctx = service_ctx(project)?;
        let type_id = || GtsTypeId::new(crate::project_sources::PROJECT_CONFIG_TYPE);
        let mut last = String::new();
        for _ in 0..3 {
            let (mut value, version) = match self.am.get_metadata(&ctx, project, type_id()).await {
                Ok(entry) => (entry.value, entry.version),
                Err(CanonicalError::NotFound { .. }) => (json!({}), 0),
                Err(e) => return Err(retry("the project's configuration cannot be read", e)),
            };
            if !change(&mut value) {
                return Ok(false);
            }
            let mut request = UpsertMetadataRequest::new(type_id(), value);
            if version > 0 {
                request = request.with_expected_version(version);
            }
            match self.am.upsert_metadata(&ctx, project, request).await {
                Ok(_) => return Ok(true),
                Err(e) => last = e.to_string(),
            }
        }
        Err(StepError::Retry(format!(
            "the project's configuration could not be written: {last}"
        )))
    }
}

#[async_trait]
impl Steps for InProcess {
    async fn tenant(&self, plan: &Plan) -> Result<String, StepError> {
        let ctx = service_ctx(plan.organization_id)?;
        if self.am.get_tenant(&ctx, plan.project_id).await.is_ok() {
            return Ok(format!("{} was there already", plan.project_id));
        }
        let request = CreateTenantRequest::new(
            plan.project_id,
            plan.workspace_id,
            plan.name.clone(),
            GtsTypeId::new(PROJECT_TENANT_TYPE),
        );
        match self.am.create_tenant(&ctx, request).await {
            Ok(t) => Ok(format!("{} ({})", t.name, plan.project_id)),
            // Made by an attempt whose answer was lost.
            Err(CanonicalError::AlreadyExists { .. }) => {
                Ok(format!("{} was there already", plan.project_id))
            }
            Err(e) => Err(retry("the project tenant could not be created", e)),
        }
    }

    async fn config(&self, plan: &Plan) -> Result<String, StepError> {
        let fields = plan.config.clone();
        let changed = self
            .change_config(plan.project_id, |c| with_fields(c, &fields))
            .await?;
        let names: Vec<&str> = plan.config.keys().map(String::as_str).collect();
        Ok(if changed {
            format!("set {}", names.join(", "))
        } else {
            "as planned already".to_string()
        })
    }

    async fn repository(&self, plan: &Plan) -> Result<MadeRepo, StepError> {
        use crate::product::port::{ProjectRepositories, RepositoryTarget};
        let Some(r) = plan.repository.as_ref() else {
            return Err(StepError::Fail("the plan names no repository".to_string()));
        };
        let repos = self
            .hub
            .get::<dyn ProjectRepositories>()
            .map_err(|_| StepError::Fail("studio-product is not in this deployment".to_string()))?;
        // The organization's connection, as the service in the organization.
        let ctx = service_ctx(plan.organization_id)?;
        let made_from = |t: RepositoryTarget, clone_url: Option<String>| MadeRepo {
            clone_url: clone_url.unwrap_or_else(|| format!("https://github.com/{}", t.repo)),
            full_name: t.repo,
            default_branch: t.base_branch,
            connection_id: r.connection_id,
            holder: r.holder,
        };
        // A repository an earlier attempt recorded is the one.
        if let Some(t) = repos
            .gear_repository(&ctx, plan.project_id)
            .await
            .map_err(|e| retry("the project's repository cannot be read", e))?
        {
            return Ok(made_from(t, None));
        }
        if r.mode == "existing" {
            let full_path = r.full_path.clone().unwrap_or_default();
            let target = RepositoryTarget {
                tenant: r.holder,
                connection_id: Some(r.connection_id),
                repo: full_path,
                base_branch: r
                    .default_branch
                    .clone()
                    .unwrap_or_else(|| "main".to_string()),
            };
            repos
                .attach(&ctx, plan.project_id, &target)
                .await
                .map_err(|e| retry("the repository could not be attached", e))?;
            return Ok(made_from(target, r.clone_url.clone()));
        }
        let name = r.name.clone().unwrap_or_default();
        let made = repos
            .create(
                &ctx,
                plan.project_id,
                r.holder,
                Some(r.connection_id),
                r.owner.as_deref(),
                r.is_org,
                &name,
                r.private,
            )
            .await
            .map_err(|e| retry("the repository could not be created", e))?;
        Ok(MadeRepo {
            full_name: made.full_name,
            clone_url: made.clone_url,
            default_branch: made.default_branch,
            connection_id: r.connection_id,
            holder: r.holder,
        })
    }

    async fn sources(&self, plan: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError> {
        let picks = plan.sources.clone();
        let repo = repo.cloned();
        let changed = self
            .change_config(plan.project_id, |c| add_sources(c, &picks, repo.as_ref()))
            .await?;
        let n = plan.sources.len() + usize::from(repo.is_some());
        Ok(if changed {
            format!("{n} repositories in the project's sources")
        } else {
            "in the project's sources already".to_string()
        })
    }

    async fn scaffold(&self, plan: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError> {
        use crate::product::port::{GearScaffolds, NewGear, RepositoryTarget, ScaffoldFailure};
        let Some(s) = plan.scaffold.as_ref() else {
            return Err(StepError::Fail(
                "the plan names no starter gear".to_string(),
            ));
        };
        let Some(repo) = repo else {
            return Err(StepError::Fail(
                "a starter gear needs the repository step before it".to_string(),
            ));
        };
        let scaffolds = self
            .hub
            .get::<dyn GearScaffolds>()
            .map_err(|_| StepError::Fail("studio-product is not in this deployment".to_string()))?;
        let ctx = service_ctx(plan.organization_id)?;
        let target = RepositoryTarget {
            tenant: repo.holder,
            connection_id: Some(repo.connection_id),
            repo: repo.full_name.clone(),
            base_branch: repo.default_branch.clone(),
        };
        let gear = NewGear {
            slug: s.slug.clone(),
            app_title: s.app_title.clone().or_else(|| Some(plan.name.clone())),
            problem: s.problem.clone(),
            origin: Some("Scaffolded when the project was created.".to_string()),
            parent_dir: s.parent_dir.clone(),
            gear_kind: s.gear_kind.clone(),
            plugin_host: s.plugin_host.clone(),
            plugin_spec: s.plugin_spec.clone(),
            open_pr: s.open_pr,
            ..NewGear::default()
        };
        match scaffolds.scaffold_into(&ctx, &target, &gear).await {
            Ok(o) => Ok(match o.pr_url {
                Some(pr) => format!("on {} ({pr})", o.branch),
                None => format!("on {}", o.branch),
            }),
            Err(ScaffoldFailure::Invalid(why)) => Err(StepError::Fail(why)),
            Err(ScaffoldFailure::Failed(e)) => {
                Err(retry("the starter gear could not be written", e))
            }
        }
    }

    async fn prd(&self, plan: &Plan) -> Result<String, StepError> {
        use crate::documents::port::ProjectDocuments;
        let Some(p) = plan.prd.as_ref() else {
            return Err(StepError::Fail("the plan names no PRD".to_string()));
        };
        let documents = self.hub.get::<dyn ProjectDocuments>().map_err(|_| {
            StepError::Fail("studio-documents is not in this deployment".to_string())
        })?;
        // The workspace's document types are read too: the organization's scope.
        let ctx = service_ctx(plan.organization_id)?;
        if documents
            .has_document(&ctx, plan.workspace_id, plan.project_id, "prd")
            .await
            .map_err(|e| retry("the project's documents cannot be read", e))?
        {
            return Ok("the project has a PRD already".to_string());
        }
        documents
            .create_answered(
                &ctx,
                plan.workspace_id,
                plan.project_id,
                "prd",
                &p.title,
                &[("product".to_string(), p.answer.clone())],
                &plan.asked_by.to_string(),
            )
            .await
            .map(|id| format!("document {id}"))
            .map_err(|e| retry("the PRD could not be written", e))
    }

    async fn kits(&self, plan: &Plan) -> Result<String, StepError> {
        use crate::kit_registry::port::ProjectKitRequests;
        let kits = self
            .hub
            .get::<dyn ProjectKitRequests>()
            .map_err(|_| StepError::Fail("studio-kits is not in this deployment".to_string()))?;
        let ctx = service_ctx(plan.project_id)?;
        let have = kits
            .requested(&ctx, plan.project_id)
            .await
            .map_err(|e| retry("the project's kits cannot be read", e))?;
        let mut asked = Vec::new();
        for k in plan.kits.iter().filter(|k| !have.contains(&k.slug)) {
            kits.request(&ctx, plan.project_id, &k.slug, k.version.as_deref())
                .await
                .map_err(|e| StepError::Fail(format!("kit `{}`: {e}", k.slug)))?;
            asked.push(k.slug.clone());
        }
        Ok(if asked.is_empty() {
            "asked for already".to_string()
        } else {
            format!("asked for {}", asked.join(", "))
        })
    }
}

/// The handler studio-tasks runs.
pub struct ProjectCreateHandler {
    steps: Arc<dyn Steps>,
}

impl ProjectCreateHandler {
    pub fn new(steps: Arc<dyn Steps>) -> Self {
        Self { steps }
    }
}

#[async_trait]
impl TaskHandler for ProjectCreateHandler {
    fn task_type(&self) -> &'static str {
        TASK_TYPE
    }

    async fn run(&self, ctx: &TaskContext) -> TaskOutcome {
        let plan: Plan = match serde_json::from_value(ctx.payload.clone()) {
            Ok(p) => p,
            Err(e) => return TaskOutcome::Failed(format!("not a project-creation plan: {e}")),
        };
        // Only ever the organization the plan names: the run's tenant.
        if plan.organization_id != ctx.tenant {
            return TaskOutcome::Failed(
                "the plan's organization is not the run's tenant".to_string(),
            );
        }
        let record = Record::resume(&plan, ctx.recorded.as_ref());
        let (progress, drain) = ctx.progress_bridge();
        let mut report = |key: &str, r: &Record| {
            progress.set_with(phase(key), serde_json::to_value(r).unwrap_or(Value::Null));
        };
        let (record, ended) = run(&plan, record, self.steps.as_ref(), &mut report).await;
        drop(progress);
        let _ = drain.await;
        let result = serde_json::to_value(&record).unwrap_or(Value::Null);
        match ended {
            Ok(()) => TaskOutcome::done_with(format!("Project {} created", plan.name), result),
            Err(StepError::Retry(why)) => TaskOutcome::Retry(why),
            Err(StepError::Fail(why)) => TaskOutcome::Failed(why),
        }
    }

    fn max_attempts(&self) -> i16 {
        3
    }
}

#[cfg(test)]
#[path = "project_create_tests.rs"]
mod tests;
