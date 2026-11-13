//! Detaching a source: the order of the two steps, what is recorded, and
//! what a retried run does again.

use std::sync::Mutex;

use serde_json::json;

use super::*;

const PROJECT: Uuid = Uuid::from_u128(0x9);

fn payload() -> DetachPayload {
    DetachPayload {
        project_id: PROJECT,
        clone_url: "https://github.com/acme/api.git".into(),
        full_path: "acme/api".into(),
        asked_by: "u-1".into(),
    }
}

fn worker() -> SecurityContext {
    SecurityContext::builder()
        .subject_id(Uuid::from_u128(0x5e))
        .subject_tenant_id(Uuid::from_u128(0x0a))
        .build()
        .unwrap()
}

/// Steps over an in-memory config: what is listed, and what was asked.
struct Fake {
    config: Mutex<Value>,
    calls: Mutex<Vec<&'static str>>,
    /// The prune fails this many times first.
    prune_failures: Mutex<u32>,
}

impl Fake {
    fn with(config: Value) -> Self {
        Self {
            config: Mutex::new(config),
            calls: Mutex::new(Vec::new()),
            prune_failures: Mutex::new(0),
        }
    }
    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl DetachSteps for Fake {
    async fn unlist(
        &self,
        _: &SecurityContext,
        _: Uuid,
        clone_url: &str,
    ) -> Result<bool, StepError> {
        self.calls.lock().unwrap().push("unlist");
        Ok(without_source(&mut self.config.lock().unwrap(), clone_url))
    }
    async fn still_listed(
        &self,
        _: &SecurityContext,
        _: Uuid,
        full_path: &str,
    ) -> Result<bool, StepError> {
        self.calls.lock().unwrap().push("still_listed");
        Ok(lists_path(&self.config.lock().unwrap(), full_path))
    }
    async fn prune(
        &self,
        _: &SecurityContext,
        _: Uuid,
        _: &str,
    ) -> Result<PruneSummary, StepError> {
        self.calls.lock().unwrap().push("prune");
        let mut failures = self.prune_failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(StepError::Retry("the graph is down".into()));
        }
        Ok(PruneSummary {
            repos: 1,
            nodes: 4,
            bindings: 2,
        })
    }
}

fn config() -> Value {
    json!({
        "build": {"repo": "acme/api", "workflow": "build.yml"},
        "sources": [
            {"connection_id": "c-1", "full_path": "acme/api", "clone_url": "https://github.com/acme/api"},
            {"connection_id": "c-1", "full_path": "acme/web", "clone_url": "https://github.com/acme/web.git"}
        ]
    })
}

async fn detach(steps: &Fake, record: DetachRecord) -> (DetachRecord, Result<(), StepError>) {
    let mut phases = Vec::new();
    let mut report = |phase: &'static str, _: &DetachRecord| phases.push(phase);
    run(&payload(), &worker(), record, steps, &mut report).await
}

#[tokio::test]
async fn the_source_leaves_the_config_and_then_its_artifacts_are_forgotten() {
    let steps = Fake::with(config());
    let (record, ended) = detach(&steps, DetachRecord::resume(&payload(), None)).await;
    assert_eq!(ended, Ok(()));
    assert_eq!(steps.calls(), vec!["unlist", "still_listed", "prune"]);
    assert_eq!(record.unlisted, Some(true));
    assert_eq!(record.pruned.map(|p| p.nodes), Some(4));
    // The other source and the rest of the config are as they were.
    let left = steps.config.lock().unwrap().clone();
    assert_eq!(left["sources"].as_array().unwrap().len(), 1);
    assert_eq!(left["sources"][0]["full_path"], "acme/web");
    assert_eq!(left["build"]["workflow"], "build.yml");
    assert!(
        record.summary().contains("acme/api detached"),
        "{}",
        record.summary()
    );
}

#[tokio::test]
async fn a_retry_after_a_failed_prune_does_not_write_the_config_again() {
    let steps = Fake::with(config());
    *steps.prune_failures.lock().unwrap() = 1;
    let (record, ended) = detach(&steps, DetachRecord::resume(&payload(), None)).await;
    assert!(matches!(ended, Err(StepError::Retry(_))));
    assert_eq!(record.unlisted, Some(true));
    assert!(record.pruned.is_none());

    // The run's recorded result is what the next attempt starts from.
    let recorded = serde_json::to_value(&record).unwrap();
    let resumed = DetachRecord::resume(&payload(), Some(&recorded));
    let (record, ended) = detach(&steps, resumed).await;
    assert_eq!(ended, Ok(()));
    assert_eq!(
        steps.calls(),
        vec!["unlist", "still_listed", "prune", "still_listed", "prune"]
    );
    assert_eq!(
        record.unlisted,
        Some(true),
        "what the first attempt did is kept"
    );
    assert!(record.pruned.is_some());
}

#[tokio::test]
async fn a_source_already_gone_from_the_config_is_still_pruned() {
    // The config write landed but its answer was lost with the run's record.
    let steps = Fake::with(json!({"sources": []}));
    let (record, ended) = detach(&steps, DetachRecord::resume(&payload(), None)).await;
    assert_eq!(ended, Ok(()));
    assert_eq!(record.unlisted, Some(false));
    assert!(record.pruned.is_some());
    assert!(
        record.summary().contains("was not among"),
        "{}",
        record.summary()
    );
}

#[tokio::test]
async fn a_repository_still_attached_through_another_source_is_not_pruned() {
    let steps = Fake::with(json!({"sources": [
        {"connection_id": "c-1", "full_path": "acme/api", "clone_url": "https://github.com/acme/api.git"},
        {"connection_id": "c-2", "full_path": "acme/api", "clone_url": "https://gitlab.example/acme/api.git"}
    ]}));
    let (record, ended) = detach(&steps, DetachRecord::resume(&payload(), None)).await;
    assert_eq!(ended, Ok(()));
    assert_eq!(steps.calls(), vec!["unlist", "still_listed"]);
    assert!(record.kept_attached);
    assert!(record.pruned.is_none());
}

#[test]
fn another_detach_s_record_is_not_resumed() {
    let other = DetachRecord {
        project_id: PROJECT,
        full_path: "acme/web".into(),
        unlisted: Some(true),
        ..DetachRecord::default()
    };
    let resumed = DetachRecord::resume(&payload(), Some(&serde_json::to_value(other).unwrap()));
    assert_eq!(resumed.unlisted, None);
    assert_eq!(resumed.full_path, "acme/api");
}

#[test]
fn the_entry_is_matched_by_repository_not_by_spelling() {
    let mut config = json!({"sources": [
        {"clone_url": "https://user@GitHub.com/acme/api/"},
        {"clone_url": "https://github.com/acme/api-docs.git"}
    ]});
    assert!(without_source(
        &mut config,
        "https://github.com/acme/api.git"
    ));
    assert_eq!(config["sources"].as_array().unwrap().len(), 1);
    assert!(!without_source(
        &mut config,
        "https://github.com/acme/api.git"
    ));
    assert!(!without_source(
        &mut json!({}),
        "https://github.com/acme/api.git"
    ));
}
