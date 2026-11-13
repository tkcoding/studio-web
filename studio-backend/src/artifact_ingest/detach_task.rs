//! The `artifact.source_detach` task: take a repository out of a project, as
//! one durable run.
//!
//! Detaching a source is two writes: the project's config loses the entry
//! (`project.config` `sources[]`), and everything synced from the repository
//! into the project is forgotten (what `POST /reconcile` does). The portal used
//! to make them one after the other from the browser, and a reconcile that
//! failed, or a tab closed between the two, left the repository's files, pull
//! requests and specs in a project that no longer names it -- with no row left
//! in Sources to try again from (`docs/feature/project-sources.md`, #1042).
//!
//! Here both are steps of one `studio-tasks` run:
//!
//! 1. **`unlist`** -- the entry whose clone URL names the repository leaves the
//!    config, version-checked, the rest of the config untouched. A config that
//!    no longer lists it is this step done (an attempt whose answer was lost).
//! 2. **`prune`** -- the repository's nodes in the project's attachment scope
//!    are forgotten, with what was synced from them and their documents'
//!    bindings. Skipped when the config still names a source with the same
//!    path (attached a second time, through another connection): forgetting it
//!    then would empty a source that is still there.
//!
//! **On whose behalf.** A run has no request behind it
//! (`cpt-studio-principle-tasks-authorize-at-enqueue`): the route checks, as the
//! caller, that the project is theirs to reach and that its config lists the
//! source; the run then writes the config as the worker scoped to the project
//! alone, and prunes in the run's tenant -- the tenant a sync of the repository
//! writes its nodes in.
//!
//! **Resumable.** Each finished step is recorded in the run's result and read
//! back by the next attempt or a `POST /studio-tasks/v1/runs/{id}/retry`; both
//! steps are idempotent besides, so a record lost with a crash costs a read.

use std::sync::Arc;

use account_management_sdk::{AccountManagementClient, UpsertMetadataRequest};
use async_trait::async_trait;
use gts::GtsTypeId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use toolkit_canonical_errors::CanonicalError;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use crate::project_sources::{PROJECT_CONFIG_TYPE, same_repository};
use crate::tasks::sdk::{TaskContext, TaskHandler, TaskOutcome};

use super::service::{IngestService, PruneSummary};

/// Task type. A wire contract: stored on every queued run.
pub const TASK_TYPE: &str = "artifact.source_detach";

/// What the route puts on the queue: the source, as the caller's read of the
/// project's config found it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetachPayload {
    pub project_id: Uuid,
    /// The entry's clone URL: what names the source in the config.
    pub clone_url: String,
    /// `owner/repo`: what names the repository in the artifact graph.
    pub full_path: String,
    /// Who asked, for the history. Authority was decided when they asked.
    pub asked_by: String,
}

/// The run's record: its result while it runs and when it ends.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetachRecord {
    pub project_id: Uuid,
    pub full_path: String,
    /// Set once the config no longer lists the source: `true` when this run
    /// took it out, `false` when it was out already.
    #[serde(default)]
    pub unlisted: Option<bool>,
    /// Set once the prune ran.
    #[serde(default)]
    pub pruned: Option<PruneSummary>,
    /// The config still names a source with this path, so nothing was pruned.
    #[serde(default)]
    pub kept_attached: bool,
}

impl DetachRecord {
    /// A fresh record for `payload`, or the one an earlier attempt of the same
    /// detach recorded.
    pub fn resume(payload: &DetachPayload, recorded: Option<&Value>) -> Self {
        recorded
            .and_then(|v| serde_json::from_value::<DetachRecord>(v.clone()).ok())
            .filter(|r| r.project_id == payload.project_id && r.full_path == payload.full_path)
            .unwrap_or_else(|| DetachRecord {
                project_id: payload.project_id,
                full_path: payload.full_path.clone(),
                ..DetachRecord::default()
            })
    }

    fn finished(&self) -> bool {
        self.unlisted.is_some() && (self.pruned.is_some() || self.kept_attached)
    }

    /// One line for a person.
    pub fn summary(&self) -> String {
        let what = if self.unlisted == Some(false) {
            format!("{} was not among the project's sources", self.full_path)
        } else {
            format!("{} detached from the project", self.full_path)
        };
        match (&self.pruned, self.kept_attached) {
            (_, true) => {
                format!("{what}; still attached through another source, nothing forgotten")
            }
            (Some(p), _) => format!(
                "{what}; forgot {} repository node(s), {} artifact(s), {} binding(s)",
                p.repos, p.nodes, p.bindings
            ),
            (None, false) => what,
        }
    }
}

/// Why a step stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepError {
    /// A gear or the config's store that is down: worth another attempt.
    Retry(String),
    /// Will not work without a person.
    Fail(String),
}

/// The two steps, behind a trait so the order and the record are tested
/// without account-management or a graph.
#[async_trait]
pub trait DetachSteps: Send + Sync {
    /// Take every entry naming `clone_url`'s repository out of the project's
    /// config. `Ok(true)` when one was there.
    async fn unlist(
        &self,
        security: &SecurityContext,
        project: Uuid,
        clone_url: &str,
    ) -> Result<bool, StepError>;
    /// Whether the config still names a source with `full_path`.
    async fn still_listed(
        &self,
        security: &SecurityContext,
        project: Uuid,
        full_path: &str,
    ) -> Result<bool, StepError>;
    /// Forget the repository in the project's attachment scope.
    async fn prune(
        &self,
        security: &SecurityContext,
        project: Uuid,
        full_path: &str,
    ) -> Result<PruneSummary, StepError>;
}

/// Carry out what `record` has not done yet, reporting it after each step.
pub async fn run(
    payload: &DetachPayload,
    security: &SecurityContext,
    mut record: DetachRecord,
    steps: &dyn DetachSteps,
    report: &mut (dyn FnMut(&'static str, &DetachRecord) + Send),
) -> (DetachRecord, Result<(), StepError>) {
    if record.unlisted.is_none() {
        report("Taking the source out of the project's config", &record);
        match steps
            .unlist(security, payload.project_id, &payload.clone_url)
            .await
        {
            Ok(was_there) => record.unlisted = Some(was_there),
            Err(e) => return (record, Err(e)),
        }
        report("Taken out of the project's config", &record);
    }
    if !record.finished() {
        report("Forgetting what was synced from the repository", &record);
        match steps
            .still_listed(security, payload.project_id, &payload.full_path)
            .await
        {
            Ok(true) => record.kept_attached = true,
            Ok(false) => match steps
                .prune(security, payload.project_id, &payload.full_path)
                .await
            {
                Ok(summary) => record.pruned = Some(summary),
                Err(e) => return (record, Err(e)),
            },
            Err(e) => return (record, Err(e)),
        }
        report("Detached", &record);
    }
    (record, Ok(()))
}

/// The steps, in this process.
pub struct InProcess {
    am: Arc<dyn AccountManagementClient>,
    service: Arc<IngestService>,
}

impl InProcess {
    pub fn new(am: Arc<dyn AccountManagementClient>, service: Arc<IngestService>) -> Self {
        Self { am, service }
    }

    /// The worker, scoped to the project alone: who reads and writes the
    /// config.
    fn project_ctx(
        security: &SecurityContext,
        project: Uuid,
    ) -> Result<SecurityContext, StepError> {
        SecurityContext::builder()
            .subject_id(security.subject_id())
            .subject_type("service")
            .subject_tenant_id(project)
            .token_scopes(vec!["*".to_owned()])
            .build()
            .map_err(|e| StepError::Fail(format!("cannot build the service context: {e}")))
    }

    async fn config(
        &self,
        security: &SecurityContext,
        project: Uuid,
    ) -> Result<Option<(Value, i64)>, StepError> {
        let ctx = Self::project_ctx(security, project)?;
        match self
            .am
            .get_metadata(&ctx, project, GtsTypeId::new(PROJECT_CONFIG_TYPE))
            .await
        {
            Ok(entry) => Ok(Some((entry.value, entry.version))),
            Err(CanonicalError::NotFound { .. }) => Ok(None),
            Err(e) => Err(StepError::Retry(format!(
                "the project's config cannot be read: {e}"
            ))),
        }
    }
}

/// `config` without the entries whose clone URL names `clone_url`'s
/// repository. `true` when one went.
pub fn without_source(config: &mut Value, clone_url: &str) -> bool {
    let Some(list) = config.get_mut("sources").and_then(Value::as_array_mut) else {
        return false;
    };
    let before = list.len();
    list.retain(|entry| {
        !entry
            .get("clone_url")
            .and_then(Value::as_str)
            .is_some_and(|u| same_repository(u, clone_url))
    });
    list.len() != before
}

/// Whether `config` names a source whose path is `full_path`.
pub fn lists_path(config: &Value, full_path: &str) -> bool {
    crate::project_sources::parse(config)
        .iter()
        .any(|s| s.full_path.eq_ignore_ascii_case(full_path))
}

#[async_trait]
impl DetachSteps for InProcess {
    async fn unlist(
        &self,
        security: &SecurityContext,
        project: Uuid,
        clone_url: &str,
    ) -> Result<bool, StepError> {
        let ctx = Self::project_ctx(security, project)?;
        let mut last = String::new();
        for _ in 0..3 {
            let Some((mut value, version)) = self.config(security, project).await? else {
                return Ok(false);
            };
            if !without_source(&mut value, clone_url) {
                return Ok(false);
            }
            let mut request =
                UpsertMetadataRequest::new(GtsTypeId::new(PROJECT_CONFIG_TYPE), value);
            if version > 0 {
                request = request.with_expected_version(version);
            }
            match self.am.upsert_metadata(&ctx, project, request).await {
                Ok(_) => return Ok(true),
                // Somebody wrote the config in between: read it again.
                Err(e) => last = e.to_string(),
            }
        }
        Err(StepError::Retry(format!(
            "the project's config could not be written: {last}"
        )))
    }

    async fn still_listed(
        &self,
        security: &SecurityContext,
        project: Uuid,
        full_path: &str,
    ) -> Result<bool, StepError> {
        Ok(self
            .config(security, project)
            .await?
            .is_some_and(|(config, _)| lists_path(&config, full_path)))
    }

    async fn prune(
        &self,
        security: &SecurityContext,
        project: Uuid,
        full_path: &str,
    ) -> Result<PruneSummary, StepError> {
        self.service
            .prune_repository(security, &project.to_string(), full_path)
            .await
            .map_err(|e| StepError::Retry(format!("{e:#}")))
    }
}

/// The handler studio-tasks runs.
pub struct DetachTask {
    steps: Arc<dyn DetachSteps>,
}

impl DetachTask {
    pub fn new(steps: Arc<dyn DetachSteps>) -> Self {
        Self { steps }
    }
}

#[async_trait]
impl TaskHandler for DetachTask {
    fn task_type(&self) -> &'static str {
        TASK_TYPE
    }

    async fn run(&self, ctx: &TaskContext) -> TaskOutcome {
        let payload: DetachPayload = match serde_json::from_value(ctx.payload.clone()) {
            Ok(p) => p,
            Err(e) => {
                return TaskOutcome::Failed(format!(
                    "studio-artifact-ingest: this run's payload is not a source detach ({e})"
                ));
            }
        };
        let record = DetachRecord::resume(&payload, ctx.recorded.as_ref());
        let (progress, drain) = ctx.progress_bridge();
        let mut report = |phase: &'static str, r: &DetachRecord| {
            progress.set_with(phase, serde_json::to_value(r).unwrap_or(Value::Null));
        };
        let (record, ended) = run(
            &payload,
            &ctx.security,
            record,
            self.steps.as_ref(),
            &mut report,
        )
        .await;
        drop(progress);
        let _ = drain.await;
        let result = serde_json::to_value(&record).unwrap_or(Value::Null);
        match ended {
            Ok(()) => TaskOutcome::done_with(record.summary(), result),
            Err(StepError::Retry(why)) => TaskOutcome::Retry(why),
            Err(StepError::Fail(why)) => TaskOutcome::Failed(why),
        }
    }

    fn max_attempts(&self) -> i16 {
        3
    }
}

#[cfg(test)]
#[path = "detach_task_tests.rs"]
mod tests;
