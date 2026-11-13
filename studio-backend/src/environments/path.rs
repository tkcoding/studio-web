//! A project's path to running (#1050): Product → Build → Image →
//! Environment → Running, each step with its state, why it is where it is in
//! plain words, a checklist of what is missing, and the one action that moves
//! it on.
//!
//! Everything here is read from what the project already keeps -- the
//! product's description, the build records (with their failure, PR #928),
//! the environments it may deploy to with their bindings and configuration
//! secrets, the deploy records -- and decided by plain functions, so a screen
//! shows what is missing before anybody presses a button, not an error
//! afterwards. The cluster is not asked: its readiness is a check of its own
//! (`GET /environments/{id}/readiness`), and a build or a deploy is refused
//! with the cause when the cluster would stop it (`readiness.rs`). Specs come
//! before the Product step and are the spec mapping's (`studio-spec-mapping`).

use uuid::Uuid;

use super::failure::{self, FailureAction, FailureCause, Of};
use super::model::{Deployment, DeploymentAction, DeploymentState, Environment, EnvironmentKind};
use crate::artifact_ingest::port::BuildRecord;

/// Where a step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepState {
    /// Nothing waits here.
    Done,
    /// Something runs: a build, a deploy.
    Active,
    /// The last attempt failed; the cause says why.
    Failed,
    /// Something is missing before it can go on: the checklist says what.
    Blocked,
    /// The step to do now.
    Next,
    /// Waits for an earlier step.
    Later,
}

impl StepState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Active => "active",
            Self::Failed => "failed",
            Self::Blocked => "blocked",
            Self::Next => "next",
            Self::Later => "later",
        }
    }
}

/// What a step's button does. The screen maps `kind` onto its own action;
/// the ids say on what.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PathAction {
    /// `open_product`, `build`, `open_build`, `deploy`, `bind_profile`,
    /// `provide_secret`, `sign_in`, `open_deployment`, `open_app`,
    /// `ask_admin`, and a failure's own (`open_gear`, `choose_hardware`,
    /// `ask_organization`, `check_environment`, `open_log`).
    pub kind: &'static str,
    pub label: String,
    pub build_id: Option<String>,
    pub environment_id: Option<Uuid>,
    pub deployment_id: Option<Uuid>,
    pub key: Option<String>,
    pub gear: Option<String>,
    pub url: Option<String>,
}

impl PathAction {
    fn new(kind: &'static str, label: &str) -> Self {
        Self {
            kind,
            label: label.to_owned(),
            ..Self::default()
        }
    }
}

/// One thing a step needs, and whether it is there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// `ENVIRONMENT`, `PROFILE_BOUND`, `SECRET`, `RESEARCH_SIGN_IN`.
    pub code: &'static str,
    pub text: String,
    pub done: bool,
    pub action: Option<PathAction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathStep {
    /// `product`, `build`, `image`, `environment`, `running`.
    pub id: &'static str,
    pub state: StepState,
    pub reason: String,
    pub checklist: Vec<Check>,
    pub action: Option<PathAction>,
    /// Why the build or the deploy the step shows failed.
    pub cause: Option<FailureCause>,
    pub build_id: Option<String>,
    pub environment_id: Option<Uuid>,
    pub deployment_id: Option<Uuid>,
    /// Where the product answers, once it runs.
    pub url: Option<String>,
}

impl PathStep {
    fn new(id: &'static str, state: StepState, reason: impl Into<String>) -> Self {
        Self {
            id,
            state,
            reason: reason.into(),
            checklist: Vec::new(),
            action: None,
            cause: None,
            build_id: None,
            environment_id: None,
            deployment_id: None,
            url: None,
        }
    }
}

/// The caller's Constructor Research sign-in, where the kit applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignInState {
    SignedIn,
    /// Runs out within the Inbox's warning: whole days left.
    RunsOut(i64),
    Expired,
    None,
}

/// One environment the project may deploy to, with what it lacks there.
#[derive(Debug, Clone)]
pub struct PathEnvironment {
    pub env: Environment,
    /// A profile of the product is bound to it.
    pub bound: bool,
    /// Configuration secrets the product needs there that nothing sets.
    pub missing_secrets: Vec<String>,
}

/// What the path is decided from.
#[derive(Debug, Clone)]
pub struct PathFacts {
    /// The product's description revision Studio keeps, or `Some(0)` for one
    /// written to the repository only; `None` before there is a product.
    pub product_revision: Option<i64>,
    /// Newest first; a deploy's runs left out.
    pub builds: Vec<BuildRecord>,
    /// The environments the project may deploy to; a Research one only where
    /// the kit applies.
    pub environments: Vec<PathEnvironment>,
    /// The project's deploys, any order.
    pub deployments: Vec<Deployment>,
    /// Whether the Constructor Research kit applies to the project.
    pub research_kit: bool,
    pub sign_in: SignInState,
}

/// The path, and the step to look at now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectPath {
    pub steps: Vec<PathStep>,
    /// The first step that is not done; `running` when all are.
    pub current: &'static str,
    /// The environment the Environment and Running steps are about.
    pub environment_id: Option<Uuid>,
    /// Every environment whose newest deploy runs the product now, with
    /// where it answers.
    pub running_in: Vec<(Uuid, String, Option<String>)>,
}

/// A deploy of what runs there: not a preview.
fn release(d: &Deployment) -> bool {
    d.preview.is_none()
}

/// The newest deploy of the release in `env`.
fn newest_in(deployments: &[Deployment], env: Uuid) -> Option<&Deployment> {
    deployments
        .iter()
        .filter(|d| d.environment_id == env && release(d))
        .max_by(|a, b| a.requested_at.cmp(&b.requested_at))
}

/// Where a deploy answers: a Research application's public address.
fn url_of(d: &Deployment) -> Option<String> {
    d.preview
        .as_ref()
        .and_then(|p| p.host.as_ref().map(|h| format!("https://{h}")))
        .or_else(|| d.outcome.as_deref().and_then(failure::public_url))
}

/// The environment the path is about: where the project deployed last, else
/// the first one bound to a profile, else the first.
pub fn target_environment(envs: &[PathEnvironment], deployments: &[Deployment]) -> Option<Uuid> {
    let known = |id: Uuid| envs.iter().any(|e| e.env.id == id);
    deployments
        .iter()
        .filter(|d| release(d) && known(d.environment_id))
        .max_by(|a, b| a.requested_at.cmp(&b.requested_at))
        .map(|d| d.environment_id)
        .or_else(|| envs.iter().find(|e| e.bound).map(|e| e.env.id))
        .or_else(|| envs.first().map(|e| e.env.id))
}

/// A failure's first action as a step's: retry means build or deploy again.
fn action_of(a: &FailureAction, retry: &'static str) -> PathAction {
    PathAction {
        kind: if a.kind == "retry" { retry } else { a.kind },
        label: a.label.clone(),
        key: a.key.clone(),
        gear: a.gear.clone(),
        ..PathAction::default()
    }
}

fn product_step(f: &PathFacts) -> PathStep {
    match f.product_revision {
        Some(0) => PathStep::new(
            "product",
            StepState::Done,
            "The product is described in the project's repository.",
        ),
        Some(r) => PathStep::new(
            "product",
            StepState::Done,
            format!("The product is described (revision {r})."),
        ),
        None => {
            let mut s = PathStep::new(
                "product",
                StepState::Next,
                "The project has no product yet: compose it from the gears its specifications \
                 need.",
            );
            s.action = Some(PathAction::new("open_product", "Compose the product"));
            s
        }
    }
}

fn build_step(f: &PathFacts) -> PathStep {
    let Some(b) = f.builds.first() else {
        if f.product_revision.is_none() {
            return PathStep::new("build", StepState::Later, "Waits for the product.");
        }
        let mut s = PathStep::new("build", StepState::Next, "Nothing is built yet.");
        s.action = Some(PathAction::new("build", "Build"));
        return s;
    };
    let mut s = match b.status.as_str() {
        "running" => {
            let mut s = PathStep::new(
                "build",
                StepState::Active,
                format!("Build {} is running.", b.build_id),
            );
            s.action = Some(PathAction::new("open_build", "Follow the build"));
            s
        }
        "passed" => PathStep::new(
            "build",
            StepState::Done,
            format!("Build {} passed.", b.build_id),
        ),
        _ => {
            let research = b.r#where.as_deref() == Some("research");
            let cause = failure::explain(
                Of::Build,
                b.failure.as_deref().unwrap_or_default(),
                b.failure_step.as_deref(),
                research,
            );
            let mut s = PathStep::new(
                "build",
                StepState::Failed,
                format!(
                    "Build {} {}: {}",
                    b.build_id,
                    if b.status == "cancelled" {
                        "was cancelled"
                    } else {
                        "failed"
                    },
                    cause.summary
                ),
            );
            s.action = cause.actions.first().map(|a| action_of(a, "build"));
            s.cause = Some(cause);
            s
        }
    };
    s.build_id = Some(b.build_id.clone());
    if let Some(a) = &mut s.action {
        a.build_id = Some(b.build_id.clone());
    }
    s
}

fn image_step(f: &PathFacts) -> PathStep {
    let Some(b) = f.builds.iter().find(|b| b.status == "passed") else {
        return PathStep::new("image", StepState::Later, "Waits for a build that passes.");
    };
    let images = b.images.len();
    let mut s = if b.r#where.as_deref() == Some("research") {
        PathStep::new(
            "image",
            StepState::Done,
            format!("Built in Constructor Research: {images} image(s), kept there."),
        )
    } else if b.chart_ref.is_some() {
        PathStep::new(
            "image",
            StepState::Done,
            format!(
                "{} is published with {images} image(s).",
                b.chart_version.as_deref().unwrap_or("The chart")
            ),
        )
    } else {
        let mut s = PathStep::new(
            "image",
            StepState::Blocked,
            "The last build that passed published no chart, so there is nothing to deploy: build \
             in Studio, or publish from the IDE or CI.",
        );
        s.action = Some(PathAction::new("build", "Build and publish"));
        s
    };
    s.build_id = Some(b.build_id.clone());
    s
}

fn environment_step(f: &PathFacts, target: Option<Uuid>) -> PathStep {
    let Some(e) = target.and_then(|id| f.environments.iter().find(|e| e.env.id == id)) else {
        let mut s = PathStep::new(
            "environment",
            if f.research_kit {
                StepState::Next
            } else {
                StepState::Blocked
            },
            if f.research_kit {
                "No environment of the organization takes this project yet; it can run in \
                 Constructor Research."
            } else {
                "No environment takes this project yet."
            },
        );
        s.checklist.push(Check {
            code: "ENVIRONMENT",
            text: "An environment the project may deploy to: an organization administrator adds \
                   one under Organization › Infrastructure."
                .to_owned(),
            done: false,
            action: Some(PathAction::new("ask_admin", "Ask an administrator")),
        });
        s.action = if f.research_kit {
            Some(PathAction::new("deploy", "Run it in Constructor Research"))
        } else {
            Some(PathAction::new("ask_admin", "Ask an administrator"))
        };
        return s;
    };
    let id = e.env.id;
    let with_env = |mut a: PathAction| {
        a.environment_id = Some(id);
        a
    };
    let mut checks = Vec::new();
    match e.env.kind {
        EnvironmentKind::Kubernetes => checks.push(Check {
            code: "PROFILE_BOUND",
            text: format!("A profile of the product is bound to {}.", e.env.name),
            done: e.bound,
            action: Some(with_env(PathAction::new("bind_profile", "Bind a profile"))),
        }),
        EnvironmentKind::Research => {
            let (done, text) = match f.sign_in {
                SignInState::SignedIn => (
                    true,
                    "You are signed in to Constructor Research.".to_owned(),
                ),
                SignInState::RunsOut(days) => (
                    true,
                    format!(
                        "You are signed in to Constructor Research; it runs out in {days} day(s)."
                    ),
                ),
                SignInState::Expired => (
                    false,
                    "Your Constructor Research sign-in has run out: sign in again.".to_owned(),
                ),
                SignInState::None => (
                    false,
                    "A Research environment runs with your own sign-in: sign in to Constructor \
                     Research."
                        .to_owned(),
                ),
            };
            checks.push(Check {
                code: "RESEARCH_SIGN_IN",
                text,
                done,
                action: Some(with_env(PathAction::new(
                    "sign_in",
                    "Sign in to Constructor Research",
                ))),
            });
        }
    }
    for key in &e.missing_secrets {
        let mut a = with_env(PathAction::new("provide_secret", "Provide it"));
        a.key = Some(key.clone());
        checks.push(Check {
            code: "SECRET",
            text: format!(
                "The product needs the secret {key} in {}; nothing sets it.",
                e.env.name
            ),
            done: false,
            action: Some(a),
        });
    }
    let missing = checks.iter().filter(|c| !c.done).count();
    let mut s = if missing == 0 {
        PathStep::new(
            "environment",
            StepState::Done,
            format!("{} is ready for a deploy.", e.env.name),
        )
    } else {
        let mut s = PathStep::new(
            "environment",
            StepState::Blocked,
            format!(
                "{} thing{} missing before a deploy to {}.",
                missing,
                if missing == 1 { " is" } else { "s are" },
                e.env.name
            ),
        );
        s.action = checks
            .iter()
            .find(|c| !c.done)
            .and_then(|c| c.action.clone());
        s
    };
    s.checklist = checks;
    s.environment_id = Some(id);
    s
}

fn running_step(f: &PathFacts, target: Option<Uuid>, ready: bool) -> PathStep {
    let env = target.and_then(|id| f.environments.iter().find(|e| e.env.id == id));
    let latest = target.and_then(|id| newest_in(&f.deployments, id));
    let deploy = |label: &str| {
        let mut a = PathAction::new("deploy", label);
        a.environment_id = target;
        a
    };
    let Some(d) = latest else {
        let mut s = if ready {
            let mut s = PathStep::new("running", StepState::Next, "Nothing is deployed yet.");
            s.action = Some(deploy("Deploy"));
            s
        } else {
            PathStep::new(
                "running",
                StepState::Later,
                "Waits for the steps before it.",
            )
        };
        s.environment_id = target;
        return s;
    };
    let research =
        d.research.is_some() || env.is_some_and(|e| e.env.kind == EnvironmentKind::Research);
    let mut s = match d.state {
        DeploymentState::Succeeded if d.action == DeploymentAction::Uninstall => {
            let mut s = PathStep::new(
                "running",
                StepState::Next,
                format!("Uninstalled from {}.", d.environment_name),
            );
            s.action = Some(deploy("Deploy again"));
            s
        }
        DeploymentState::Succeeded => {
            let url = url_of(d);
            let mut s = PathStep::new(
                "running",
                StepState::Done,
                match &url {
                    Some(u) => format!("Runs in {} at {u}.", d.environment_name),
                    None => format!("Runs in {} ({}).", d.environment_name, d.namespace),
                },
            );
            if let Some(u) = &url {
                let mut a = PathAction::new("open_app", "Open the application");
                a.url = Some(u.clone());
                s.action = Some(a);
            }
            s.url = url;
            s
        }
        DeploymentState::Failed => {
            let text = d
                .outcome
                .as_deref()
                .or(d.reason.as_deref())
                .unwrap_or_default();
            let cause = failure::explain(Of::Deploy, text, None, research);
            let mut s = PathStep::new(
                "running",
                StepState::Failed,
                format!(
                    "The deploy to {} failed: {}",
                    d.environment_name, cause.summary
                ),
            );
            s.action = cause.actions.first().map(|a| {
                let mut a = action_of(a, "deploy");
                a.environment_id = Some(d.environment_id);
                a
            });
            s.cause = Some(cause);
            s
        }
        DeploymentState::Declined => {
            let mut s = PathStep::new(
                "running",
                StepState::Failed,
                format!(
                    "The deploy to {} was declined{}",
                    d.environment_name,
                    d.reason
                        .as_deref()
                        .map(|r| format!(": {r}"))
                        .unwrap_or_else(|| ".".to_owned())
                ),
            );
            s.action = Some(deploy("Deploy again"));
            s
        }
        DeploymentState::AwaitingApproval => {
            let mut s = PathStep::new(
                "running",
                StepState::Blocked,
                format!(
                    "The deploy to {} waits for an administrator to approve it.",
                    d.environment_name
                ),
            );
            let mut a = PathAction::new("open_deployment", "Open the deploy");
            a.deployment_id = Some(d.id);
            s.action = Some(a);
            s
        }
        DeploymentState::Queued | DeploymentState::Running => {
            let mut s = PathStep::new(
                "running",
                StepState::Active,
                format!("Deploying to {}.", d.environment_name),
            );
            let mut a = PathAction::new("open_deployment", "Follow the deploy");
            a.deployment_id = Some(d.id);
            s.action = Some(a);
            s
        }
        DeploymentState::Cancelled => {
            let mut s = PathStep::new(
                "running",
                StepState::Next,
                format!("The deploy to {} was cancelled.", d.environment_name),
            );
            s.action = Some(deploy("Deploy"));
            s
        }
    };
    s.deployment_id = Some(d.id);
    s.environment_id = Some(d.environment_id);
    if let Some(a) = &mut s.action
        && a.deployment_id.is_none()
        && a.kind == "open_log"
    {
        a.deployment_id = Some(d.id);
    }
    s
}

/// The path of a project, from what it keeps.
pub fn project_path(f: &PathFacts) -> ProjectPath {
    let target = target_environment(&f.environments, &f.deployments);
    let product = product_step(f);
    let build = build_step(f);
    let image = image_step(f);
    let environment = environment_step(f, target);
    let ready = image.state == StepState::Done && environment.state == StepState::Done;
    let running = running_step(f, target, ready);
    let mut steps = vec![product, build, image, environment, running];
    // What runs already counts whatever the steps before it say now: a
    // product deployed once runs while its next build fails.
    let current = steps
        .iter()
        .find(|s| s.state != StepState::Done)
        .map_or("running", |s| s.id);
    // The steps after the one to look at that have nothing of their own to
    // say wait for it, rather than offering to jump ahead.
    let at = steps.iter().position(|s| s.id == current).unwrap_or(0);
    for s in steps.iter_mut().skip(at + 1) {
        if s.state == StepState::Next {
            s.state = StepState::Later;
        }
    }
    let running_in = f
        .environments
        .iter()
        .filter_map(|e| {
            let d = newest_in(&f.deployments, e.env.id)?;
            (d.state == DeploymentState::Succeeded && d.action != DeploymentAction::Uninstall)
                .then(|| (e.env.id, e.env.name.clone(), url_of(d)))
        })
        .collect();
    ProjectPath {
        steps,
        current,
        environment_id: target,
        running_in,
    }
}

#[cfg(test)]
#[path = "path_tests.rs"]
mod tests;
