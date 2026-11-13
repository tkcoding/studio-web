//! The path to running for the projects #1050 names: one with no product,
//! one whose build failed, one missing a secret, one running in an
//! environment, and one running in Constructor Research.

use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::artifact_ingest::port::BuildRecord;

const CLUSTER: Uuid = Uuid::from_u128(0xc1);
const RESEARCH: Uuid = Uuid::from_u128(0x2e);

fn environment(id: Uuid, name: &str, kind: &str) -> Environment {
    let mut v = json!({
        "id": id,
        "name": name,
        "kind": kind,
        "connection_id": Uuid::from_u128(9),
        "registry": if kind == "kubernetes" { "registry.example/acme" } else { "" },
        "updated_by": "admin",
        "updated_at": "2026-11-01T00:00:00Z",
    });
    if kind == "research" {
        v["research"] = json!({"project": "ml-team"});
    }
    serde_json::from_value(v).expect("an environment")
}

fn place(id: Uuid, name: &str, kind: &str, bound: bool, missing: &[&str]) -> PathEnvironment {
    PathEnvironment {
        env: environment(id, name, kind),
        bound,
        missing_secrets: missing.iter().map(|k| (*k).to_owned()).collect(),
    }
}

fn build(id: &str, status: &str) -> BuildRecord {
    BuildRecord::of(&json!({
        "build_id": id,
        "where": "studio",
        "status": status,
        "images": [{"app": "api", "image": "shop/api:1"}],
        "chart": {"reference": "oci://registry.example/acme/shop/chart", "version": "0.1.0"},
    }))
}

fn deploy(env: Uuid, at: &str, state: &str, outcome: Option<&str>) -> Deployment {
    serde_json::from_value(json!({
        "id": Uuid::new_v4(),
        "project_id": Uuid::from_u128(1),
        "environment_id": env,
        "environment_name": if env == RESEARCH { "Research" } else { "dev" },
        "profile": "prod",
        "product": "shop",
        "namespace": "shop-dev",
        "state": state,
        "requested_by": "ann",
        "requested_at": at,
        "outcome": outcome,
    }))
    .expect("a deployment")
}

fn facts() -> PathFacts {
    PathFacts {
        product_revision: Some(3),
        builds: vec![build("b2", "passed")],
        environments: vec![place(CLUSTER, "dev", "kubernetes", true, &[])],
        deployments: Vec::new(),
        research_kit: false,
        sign_in: SignInState::None,
    }
}

fn step<'p>(p: &'p ProjectPath, id: &str) -> &'p PathStep {
    p.steps.iter().find(|s| s.id == id).expect("the step")
}

#[test]
fn a_project_without_a_product_is_asked_to_compose_one_and_nothing_after_offers_itself() {
    let f = PathFacts {
        product_revision: None,
        builds: Vec::new(),
        ..facts()
    };
    let p = project_path(&f);
    assert_eq!(p.current, "product");
    let product = step(&p, "product");
    assert_eq!(product.state, StepState::Next);
    assert_eq!(product.action.as_ref().unwrap().kind, "open_product");
    assert_eq!(step(&p, "build").state, StepState::Later);
    assert_eq!(step(&p, "image").state, StepState::Later);
    assert_eq!(step(&p, "running").state, StepState::Later);
    let ids: Vec<_> = p.steps.iter().map(|s| s.id).collect();
    assert_eq!(ids, ["product", "build", "image", "environment", "running"]);
}

#[test]
fn a_failed_build_names_its_gear_and_offers_to_open_it() {
    let mut failed = build("b3", "failed");
    failed.failure = Some("error: gear `billing` · help: currency is required".to_owned());
    failed.failure_step = Some("prepare".to_owned());
    let f = PathFacts {
        builds: vec![failed],
        ..facts()
    };
    let p = project_path(&f);
    assert_eq!(p.current, "build");
    let b = step(&p, "build");
    assert_eq!(b.state, StepState::Failed);
    assert!(b.reason.contains("billing"), "{}", b.reason);
    let a = b.action.as_ref().unwrap();
    assert_eq!(a.kind, "open_gear");
    assert_eq!(a.gear.as_deref(), Some("billing"));
    assert_eq!(a.build_id.as_deref(), Some("b3"));
    assert_eq!(b.cause.as_ref().unwrap().code, "GEAR_BUILD_FAILED");
    // Nothing passed, so there is no image to deploy yet.
    assert_eq!(step(&p, "image").state, StepState::Later);
}

#[test]
fn a_missing_secret_is_a_checklist_item_before_anybody_deploys() {
    let f = PathFacts {
        environments: vec![place(
            CLUSTER,
            "dev",
            "kubernetes",
            true,
            &["SMTP_PASSWORD"],
        )],
        ..facts()
    };
    let p = project_path(&f);
    assert_eq!(p.current, "environment");
    let e = step(&p, "environment");
    assert_eq!(e.state, StepState::Blocked);
    let missing: Vec<_> = e.checklist.iter().filter(|c| !c.done).collect();
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].code, "SECRET");
    let a = e.action.as_ref().unwrap();
    assert_eq!(a.kind, "provide_secret");
    assert_eq!(a.key.as_deref(), Some("SMTP_PASSWORD"));
    assert_eq!(a.environment_id, Some(CLUSTER));
    // The deploy waits for it rather than being offered.
    assert_eq!(step(&p, "running").state, StepState::Later);
    // An unbound environment says so the same way.
    let f = PathFacts {
        environments: vec![place(CLUSTER, "dev", "kubernetes", false, &[])],
        ..facts()
    };
    let p = project_path(&f);
    assert_eq!(
        step(&p, "environment").action.as_ref().unwrap().kind,
        "bind_profile"
    );
}

#[test]
fn a_ready_project_is_asked_to_deploy_and_a_running_one_is_done() {
    let p = project_path(&facts());
    assert_eq!(p.current, "running");
    let r = step(&p, "running");
    assert_eq!(r.state, StepState::Next);
    assert_eq!(r.action.as_ref().unwrap().kind, "deploy");
    assert_eq!(r.action.as_ref().unwrap().environment_id, Some(CLUSTER));

    let f = PathFacts {
        deployments: vec![deploy(
            CLUSTER,
            "2026-11-02T00:00:00Z",
            "succeeded",
            Some("installed"),
        )],
        ..facts()
    };
    let p = project_path(&f);
    assert!(p.steps.iter().all(|s| s.state == StepState::Done));
    assert_eq!(p.current, "running");
    assert!(step(&p, "running").reason.starts_with("Runs in dev"));
    assert_eq!(p.running_in.len(), 1);
}

#[test]
fn a_failed_deploy_says_its_cause_and_names_the_deployment() {
    let failed = deploy(
        CLUSTER,
        "2026-11-03T00:00:00Z",
        "failed",
        Some("pod a container b: ImagePullBackOff: manifest unknown"),
    );
    let f = PathFacts {
        deployments: vec![
            deploy(CLUSTER, "2026-11-02T00:00:00Z", "succeeded", None),
            failed.clone(),
        ],
        ..facts()
    };
    let p = project_path(&f);
    let r = step(&p, "running");
    assert_eq!(r.state, StepState::Failed);
    assert_eq!(r.deployment_id, Some(failed.id));
    assert_eq!(r.cause.as_ref().unwrap().code, "IMAGE_PULL_FAILED");
    // The newest deploy failed, so it does not run there any more as far as
    // the path tells.
    assert!(p.running_in.is_empty());
}

#[test]
fn a_research_project_needs_the_sign_in_and_runs_at_its_public_address() {
    let mut f = PathFacts {
        builds: vec![{
            let mut b = build("r1", "passed");
            b.r#where = Some("research".to_owned());
            b.chart_ref = None;
            b
        }],
        environments: vec![place(RESEARCH, "Research", "research", false, &[])],
        research_kit: true,
        sign_in: SignInState::Expired,
        ..facts()
    };
    let p = project_path(&f);
    assert_eq!(step(&p, "image").state, StepState::Done);
    let e = step(&p, "environment");
    assert_eq!(e.state, StepState::Blocked);
    assert_eq!(e.action.as_ref().unwrap().kind, "sign_in");

    f.sign_in = SignInState::SignedIn;
    f.deployments = vec![deploy(
        RESEARCH,
        "2026-11-04T00:00:00Z",
        "succeeded",
        Some("shop-research runs in Constructor Research: https://shop.research.example"),
    )];
    let p = project_path(&f);
    let r = step(&p, "running");
    assert_eq!(r.state, StepState::Done);
    assert_eq!(r.url.as_deref(), Some("https://shop.research.example"));
    assert_eq!(r.action.as_ref().unwrap().kind, "open_app");

    // An expired sign-in that broke the deploy says to sign in again.
    f.deployments.push(deploy(
        RESEARCH,
        "2026-11-05T00:00:00Z",
        "failed",
        Some("the Constructor Research connection cannot be used: invalid_grant"),
    ));
    let p = project_path(&f);
    let r = step(&p, "running");
    assert_eq!(r.cause.as_ref().unwrap().code, "RESEARCH_SIGN_IN_EXPIRED");
    assert_eq!(r.action.as_ref().unwrap().kind, "sign_in");
}

#[test]
fn without_an_environment_research_is_offered_only_with_the_kit() {
    let f = PathFacts {
        environments: Vec::new(),
        ..facts()
    };
    let p = project_path(&f);
    let e = step(&p, "environment");
    assert_eq!(e.state, StepState::Blocked);
    assert_eq!(e.action.as_ref().unwrap().kind, "ask_admin");

    let f = PathFacts {
        environments: Vec::new(),
        research_kit: true,
        ..facts()
    };
    let e = step(&project_path(&f), "environment").clone();
    assert_eq!(e.state, StepState::Next);
    assert_eq!(e.action.as_ref().unwrap().kind, "deploy");
}
