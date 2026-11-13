//! The order of a project's creation, what it records, and that a retry
//! continues where the last attempt stopped -- the prototype's
//! `runProvision` contract (`buildCreatePlan` in `App.tsx`), over a fake of
//! the steps.

use std::sync::Mutex;

use serde_json::json;

use super::*;

fn plan() -> Plan {
    Plan {
        asked_by: Uuid::from_u128(1),
        organization_id: Uuid::from_u128(2),
        workspace_id: Uuid::from_u128(3),
        project_id: Uuid::from_u128(4),
        name: "Shop".into(),
        config: serde_json::from_value(json!({ "mode": "greenfield", "status": "draft" })).unwrap(),
        sources: vec![SourcePick {
            connection_id: Uuid::from_u128(5),
            holder: Uuid::from_u128(2),
            full_path: "acme/shop".into(),
            clone_url: "https://github.com/acme/shop.git".into(),
            branch: Some("main".into()),
        }],
        repository: None,
        scaffold: None,
        prd: Some(PrdPlan {
            title: "Shop".into(),
            answer: "A shop.".into(),
        }),
        kits: vec![KitPick {
            slug: "sdlc".into(),
            version: None,
        }],
    }
}

/// Steps that succeed, except the ones told to fail, and remember what ran.
#[derive(Default)]
struct Fake {
    ran: Mutex<Vec<String>>,
    fail: Mutex<Vec<(String, StepError)>>,
}

impl Fake {
    fn step(&self, key: &str) -> Result<String, StepError> {
        self.ran.lock().unwrap().push(key.to_string());
        let mut fail = self.fail.lock().unwrap();
        if let Some(at) = fail.iter().position(|(k, _)| k == key) {
            return Err(fail.remove(at).1);
        }
        Ok(format!("{key} done"))
    }

    fn ran(&self) -> Vec<String> {
        self.ran.lock().unwrap().clone()
    }
}

#[async_trait]
impl Steps for Fake {
    async fn tenant(&self, _: &Plan) -> Result<String, StepError> {
        self.step("tenant")
    }
    async fn config(&self, _: &Plan) -> Result<String, StepError> {
        self.step("config")
    }
    async fn repository(&self, p: &Plan) -> Result<MadeRepo, StepError> {
        self.step("repository")?;
        Ok(MadeRepo {
            full_name: "acme/gears".into(),
            clone_url: "https://github.com/acme/gears".into(),
            default_branch: "main".into(),
            connection_id: p.repository.as_ref().unwrap().connection_id,
            holder: p.organization_id,
        })
    }
    async fn sources(&self, _: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError> {
        self.step(if repo.is_some() {
            "sources+repo"
        } else {
            "sources"
        })
    }
    async fn scaffold(&self, _: &Plan, repo: Option<&MadeRepo>) -> Result<String, StepError> {
        assert!(
            repo.is_some(),
            "a starter gear is written into the repository made before it"
        );
        self.step("scaffold")
    }
    async fn prd(&self, _: &Plan) -> Result<String, StepError> {
        self.step("prd")
    }
    async fn kits(&self, _: &Plan) -> Result<String, StepError> {
        self.step("kits")
    }
}

async fn go(
    plan: &Plan,
    record: Record,
    steps: &Fake,
) -> (Record, Result<(), StepError>, Vec<Record>) {
    let mut seen = Vec::new();
    let mut report = |_: &str, r: &Record| seen.push(r.clone());
    let (r, ended) = run(plan, record, steps, &mut report).await;
    (r, ended, seen)
}

#[test]
fn a_plan_takes_only_the_steps_it_names_in_the_prototypes_order() {
    assert_eq!(
        steps_of(&plan()),
        ["tenant", "config", "sources", "prd", "kits"]
    );
    let mut full = plan();
    full.repository = Some(RepositoryPlan {
        connection_id: Uuid::from_u128(5),
        holder: Uuid::from_u128(2),
        mode: "new".into(),
        name: Some("gears".into()),
        owner: None,
        is_org: false,
        private: true,
        full_path: None,
        clone_url: None,
        default_branch: None,
    });
    full.scaffold = Some(ScaffoldPlan {
        slug: "orders".into(),
        ..ScaffoldPlan::default()
    });
    assert_eq!(
        steps_of(&full),
        [
            "tenant",
            "config",
            "repository",
            "sources",
            "scaffold",
            "prd",
            "kits"
        ]
    );
    let bare = Plan {
        sources: Vec::new(),
        prd: None,
        kits: Vec::new(),
        ..plan()
    };
    assert_eq!(steps_of(&bare), ["tenant", "config"]);
}

#[tokio::test]
async fn every_step_runs_once_in_order_and_each_is_recorded_as_it_ends() {
    let p = plan();
    let fake = Fake::default();
    let (record, ended, seen) = go(&p, Record::resume(&p, None), &fake).await;
    assert!(ended.is_ok());
    assert_eq!(fake.ran(), ["tenant", "config", "sources", "prd", "kits"]);
    assert!(record.steps.iter().all(|s| s.state == "done"));
    assert_eq!(record.project_id, p.project_id);
    assert_eq!(record.asked_by, p.asked_by);
    // A report as each step starts and one as it ends.
    assert_eq!(seen.len(), 10);
    assert_eq!(seen[1].steps[0].state, "done");
    assert_eq!(seen[1].steps[1].state, "pending");
}

#[tokio::test]
async fn a_failed_step_stops_the_run_and_a_retry_continues_from_it() {
    let p = plan();
    let fake = Fake::default();
    fake.fail
        .lock()
        .unwrap()
        .push(("prd".into(), StepError::Retry("documents down".into())));
    let (record, ended, _) = go(&p, Record::resume(&p, None), &fake).await;
    assert_eq!(ended, Err(StepError::Retry("documents down".into())));
    let prd = record.steps.iter().find(|s| s.key == "prd").unwrap();
    assert_eq!(prd.state, "failed");
    assert_eq!(prd.detail.as_deref(), Some("documents down"));
    assert_eq!(
        record.steps.iter().find(|s| s.key == "kits").unwrap().state,
        "pending"
    );

    // The next attempt reads the record back: only the failed step and
    // those after it run.
    let recorded = serde_json::to_value(&record).unwrap();
    let again = Fake::default();
    let (record, ended, _) = go(&p, Record::resume(&p, Some(&recorded)), &again).await;
    assert!(ended.is_ok());
    assert_eq!(again.ran(), ["prd", "kits"]);
    assert!(record.steps.iter().all(|s| s.state == "done"));
}

#[tokio::test]
async fn the_repository_made_is_kept_for_the_steps_after_it_and_across_attempts() {
    let mut p = plan();
    p.repository = Some(RepositoryPlan {
        connection_id: Uuid::from_u128(5),
        holder: Uuid::from_u128(2),
        mode: "new".into(),
        name: Some("gears".into()),
        owner: None,
        is_org: false,
        private: true,
        full_path: None,
        clone_url: None,
        default_branch: None,
    });
    p.scaffold = Some(ScaffoldPlan {
        slug: "orders".into(),
        ..ScaffoldPlan::default()
    });
    let fake = Fake::default();
    fake.fail
        .lock()
        .unwrap()
        .push(("scaffold".into(), StepError::Retry("provider down".into())));
    let (record, _, _) = go(&p, Record::resume(&p, None), &fake).await;
    assert_eq!(
        fake.ran(),
        ["tenant", "config", "repository", "sources+repo", "scaffold"]
    );
    assert_eq!(record.repository.as_ref().unwrap().full_name, "acme/gears");

    let recorded = serde_json::to_value(&record).unwrap();
    let again = Fake::default();
    let (_, ended, _) = go(&p, Record::resume(&p, Some(&recorded)), &again).await;
    assert!(ended.is_ok());
    // The repository is not made twice; the starter gear still finds it.
    assert_eq!(again.ran(), ["scaffold", "prd", "kits"]);
}

#[test]
fn another_plans_record_is_not_resumed() {
    let p = plan();
    let mut other = Record::resume(&p, None);
    other.project_id = Uuid::from_u128(99);
    for s in &mut other.steps {
        s.state = "done".into();
    }
    let recorded = serde_json::to_value(&other).unwrap();
    let r = Record::resume(&p, Some(&recorded));
    assert!(r.steps.iter().all(|s| s.state == "pending"));
}

#[test]
fn sources_are_added_once_each_and_the_first_names_the_projects_git_url() {
    let p = plan();
    let mut config = json!({ "mode": "greenfield" });
    assert!(add_sources(&mut config, &p.sources, None));
    assert_eq!(config["sources"].as_array().unwrap().len(), 1);
    assert_eq!(config["source_git_url"], "https://github.com/acme/shop.git");
    // The same repository spelled without `.git` is the same source.
    let mut again = p.sources.clone();
    again[0].clone_url = "https://github.com/ACME/shop".into();
    assert!(!add_sources(&mut config, &again, None));
    let made = MadeRepo {
        full_name: "acme/gears".into(),
        clone_url: "https://github.com/acme/gears".into(),
        default_branch: "main".into(),
        connection_id: Uuid::from_u128(5),
        holder: Uuid::from_u128(2),
    };
    assert!(add_sources(&mut config, &[], Some(&made)));
    let list = config["sources"].as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[1]["gears_here"], true);
    assert_eq!(config["source_git_url"], "https://github.com/acme/shop.git");
}

#[test]
fn the_configuration_takes_the_plan_but_never_moves_a_status_back() {
    let fields = plan().config;
    let mut fresh = json!({});
    assert!(with_fields(&mut fresh, &fields));
    assert_eq!(fresh, json!({ "mode": "greenfield", "status": "draft" }));
    let mut moved_on = json!({ "mode": "greenfield", "status": "active", "brief": "kept" });
    assert!(!with_fields(&mut moved_on, &fields));
    assert_eq!(moved_on["status"], "active");
    assert_eq!(moved_on["brief"], "kept");
}
