//! A project's path to running (#1050), the caller's own Constructor
//! Research projects and hardware for the one deploy dialog (#1053), and a
//! failure's cause as every record that failed carries it (#1054).

use axum::extract::{Path, Query};
use axum::{Extension, Router};
use serde::Deserialize;
use toolkit::api::canonical_prelude::*;
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::{Environments, License, ProjectQuery, TAG, problem};
use crate::environments::failure::{FailureAction, FailureCause};
use crate::environments::path::{Check, PathAction, PathStep, SignInState};

/* ── DTOs ── */

/// One thing to do about a failure.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct FailureActionDto {
    /// `open_gear`, `retry`, `provide_secret`, `choose_hardware`,
    /// `ask_organization`, `sign_in`, `check_environment`, `open_log`.
    pub kind: String,
    pub label: String,
    pub gear: Option<String>,
    pub key: Option<String>,
}

/// Why a build or a deploy failed, and what fixes it (#1054).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct FailureCauseDto {
    /// `GEAR_BUILD_FAILED`, `SECRET_MISSING`, `QUOTA_OR_HARDWARE_LIMIT`,
    /// `RESEARCH_SIGN_IN_EXPIRED`, `IMAGE_PULL_FAILED`, `CLUSTER_UNREACHABLE`,
    /// `CONNECTION_UNREADABLE`, `APP_CRASHED`, `UNKNOWN`.
    pub code: String,
    /// One sentence: what went wrong.
    pub summary: String,
    /// The gear that did not build.
    pub gear: Option<String>,
    /// The configuration secret nothing sets.
    pub key: Option<String>,
    /// The lines of the failure that matter.
    pub lines: Vec<String>,
    /// What to do, the first one first.
    pub actions: Vec<FailureActionDto>,
}

fn action_dto(a: FailureAction) -> FailureActionDto {
    FailureActionDto {
        kind: a.kind.to_owned(),
        label: a.label,
        gear: a.gear,
        key: a.key,
    }
}

pub fn cause_dto(c: FailureCause) -> FailureCauseDto {
    FailureCauseDto {
        code: c.code.to_owned(),
        summary: c.summary,
        gear: c.gear,
        key: c.key,
        lines: c.lines,
        actions: c.actions.into_iter().map(action_dto).collect(),
    }
}

/// What a step's button does, and on what.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PathActionDto {
    /// `open_product`, `build`, `open_build`, `deploy`, `bind_profile`,
    /// `provide_secret`, `sign_in`, `open_deployment`, `open_app`,
    /// `ask_admin`, or a failure's own (`open_gear`, `choose_hardware`,
    /// `ask_organization`, `check_environment`, `open_log`).
    pub kind: String,
    pub label: String,
    pub build_id: Option<String>,
    #[schema(value_type = Option<String>)]
    pub environment_id: Option<Uuid>,
    #[schema(value_type = Option<String>)]
    pub deployment_id: Option<Uuid>,
    pub key: Option<String>,
    pub gear: Option<String>,
    pub url: Option<String>,
}

/// One thing a step needs, and whether it is there.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PathCheckDto {
    /// `ENVIRONMENT`, `PROFILE_BOUND`, `SECRET`, `RESEARCH_SIGN_IN`.
    pub code: String,
    pub text: String,
    pub done: bool,
    pub action: Option<PathActionDto>,
}

/// One step of the path.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PathStepDto {
    /// `product`, `build`, `image`, `environment`, `running`.
    pub id: String,
    /// `done`, `active`, `failed`, `blocked`, `next`, `later`.
    pub state: String,
    /// Why it is where it is, in plain words.
    pub reason: String,
    /// What it needs before it can go on.
    pub checklist: Vec<PathCheckDto>,
    /// The one action that moves it on.
    pub action: Option<PathActionDto>,
    /// Why the build or deploy it shows failed.
    pub cause: Option<FailureCauseDto>,
    pub build_id: Option<String>,
    #[schema(value_type = Option<String>)]
    pub environment_id: Option<Uuid>,
    #[schema(value_type = Option<String>)]
    pub deployment_id: Option<Uuid>,
    /// Where the product answers, once it runs.
    pub url: Option<String>,
}

/// Where the product runs now.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct RunningInDto {
    #[schema(value_type = String)]
    pub environment_id: Uuid,
    pub environment_name: String,
    pub url: Option<String>,
}

/// The caller's own Constructor Research sign-in.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ResearchSignInDto {
    /// `signed_in`, `runs_out`, `expired`, `none`.
    pub state: String,
    /// Whole days left, for `runs_out`.
    pub days_left: Option<i64>,
    /// The caller's own `research` connection.
    #[schema(value_type = Option<String>)]
    pub connection_id: Option<Uuid>,
}

/// A project's path from its product to running (#1050).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectPathDto {
    #[schema(value_type = String)]
    pub organization_id: Uuid,
    /// Product, Build, Image, Environment, Running, in that order.
    pub steps: Vec<PathStepDto>,
    /// The step to look at now: the first that is not done.
    pub current: String,
    /// The environment the Environment and Running steps are about.
    #[schema(value_type = Option<String>)]
    pub environment_id: Option<Uuid>,
    pub running_in: Vec<RunningInDto>,
    /// Whether the Constructor Research kit applies: without it no Research
    /// target is offered.
    pub research_kit: bool,
    /// The caller's Research sign-in; absent without the kit.
    pub research: Option<ResearchSignInDto>,
}

fn path_action_dto(a: PathAction) -> PathActionDto {
    PathActionDto {
        kind: a.kind.to_owned(),
        label: a.label,
        build_id: a.build_id,
        environment_id: a.environment_id,
        deployment_id: a.deployment_id,
        key: a.key,
        gear: a.gear,
        url: a.url,
    }
}

fn check_dto(c: Check) -> PathCheckDto {
    PathCheckDto {
        code: c.code.to_owned(),
        text: c.text,
        done: c.done,
        action: c.action.map(path_action_dto),
    }
}

fn step_dto(s: PathStep) -> PathStepDto {
    PathStepDto {
        id: s.id.to_owned(),
        state: s.state.as_str().to_owned(),
        reason: s.reason,
        checklist: s.checklist.into_iter().map(check_dto).collect(),
        action: s.action.map(path_action_dto),
        cause: s.cause.map(cause_dto),
        build_id: s.build_id,
        environment_id: s.environment_id,
        deployment_id: s.deployment_id,
        url: s.url,
    }
}

fn sign_in_dto(state: SignInState, connection_id: Option<Uuid>) -> ResearchSignInDto {
    let (state, days_left) = match state {
        SignInState::SignedIn => ("signed_in", None),
        SignInState::RunsOut(d) => ("runs_out", Some(d)),
        SignInState::Expired => ("expired", Some(0)),
        SignInState::None => ("none", None),
    };
    ResearchSignInDto {
        state: state.to_owned(),
        days_left,
        connection_id,
    }
}

/// A Research project the caller's sign-in may run products in.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct MyResearchProjectDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct MyResearchProjectListDto {
    /// The caller's own `research` connection the projects were read with:
    /// what a project's own Research environment is made with.
    #[schema(value_type = String)]
    pub connection_id: Uuid,
    pub items: Vec<MyResearchProjectDto>,
    pub total: u32,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct MyResearchHardwareDto {
    pub id: String,
    pub name: String,
    pub trial: bool,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct MyResearchHardwareListDto {
    pub items: Vec<MyResearchHardwareDto>,
    pub total: u32,
}

/* ── Handlers ── */

async fn get_project_path(
    Extension(ctx): Extension<SecurityContext>,
    Extension(envs): Extension<Environments>,
    Query(q): Query<ProjectQuery>,
) -> ApiResult<JsonBody<ProjectPathDto>> {
    let v = envs
        .0
        .project_path(&ctx, q.project_id)
        .await
        .map_err(problem)?;
    let p = v.path;
    Ok(Json(ProjectPathDto {
        organization_id: v.organization_id,
        current: p.current.to_owned(),
        environment_id: p.environment_id,
        steps: p.steps.into_iter().map(step_dto).collect(),
        running_in: p
            .running_in
            .into_iter()
            .map(|(environment_id, environment_name, url)| RunningInDto {
                environment_id,
                environment_name,
                url,
            })
            .collect(),
        research_kit: v.research_kit,
        research: v.research.map(|r| sign_in_dto(r.state, r.connection_id)),
    }))
}

async fn list_my_research_projects(
    Extension(ctx): Extension<SecurityContext>,
    Extension(envs): Extension<Environments>,
    Query(q): Query<ProjectQuery>,
) -> ApiResult<JsonBody<MyResearchProjectListDto>> {
    let (connection_id, items) = envs
        .0
        .my_research_projects(&ctx, q.project_id)
        .await
        .map_err(problem)?;
    let items: Vec<MyResearchProjectDto> = items
        .into_iter()
        .map(|p| MyResearchProjectDto {
            id: p.id,
            name: p.name,
        })
        .collect();
    Ok(Json(MyResearchProjectListDto {
        connection_id,
        total: u32::try_from(items.len()).unwrap_or(u32::MAX),
        items,
    }))
}

#[derive(Debug, Deserialize)]
pub struct MyHardwareQuery {
    project_id: Uuid,
}

async fn list_my_research_hardware(
    Extension(ctx): Extension<SecurityContext>,
    Extension(envs): Extension<Environments>,
    Path(research_project): Path<String>,
    Query(q): Query<MyHardwareQuery>,
) -> ApiResult<JsonBody<MyResearchHardwareListDto>> {
    let items: Vec<MyResearchHardwareDto> = envs
        .0
        .my_research_hardware(&ctx, q.project_id, &research_project)
        .await
        .map_err(problem)?
        .into_iter()
        .map(|h| MyResearchHardwareDto {
            id: h.id,
            name: h.name,
            trial: h.trial,
        })
        .collect();
    Ok(Json(MyResearchHardwareListDto {
        total: u32::try_from(items.len()).unwrap_or(u32::MAX),
        items,
    }))
}

/* ── Registration ── */

pub fn register(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    router = OperationBuilder::get("/studio-environments/v1/project-path")
        .operation_id("studio_environments.get_project_path")
        .summary("Where a project stands on its way from a product to running")
        .description(
            "For `?project_id=`, one read (#1050): the steps Product, Build, Image, Environment \
             and Running, each with its `state` (`done`, `active`, `failed`, `blocked`, `next`, \
             `later`), why in plain words, a `checklist` of what is missing before anybody \
             presses anything (a profile bound, the configuration secrets the product needs \
             there, the caller's Research sign-in), the one `action` that moves it on, and for a \
             failed build or deploy its `cause` with the actions that fix it. Read from the \
             records Studio keeps; the cluster is not asked (`…/environments/{id}/readiness` \
             does). `research_kit` says whether Constructor Research is offered at all.",
        )
        .tag(TAG)
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("project_id", true, "The project", "string")
        .handler(get_project_path)
        .json_response_with_schema::<ProjectPathDto>(openapi, StatusCode::OK, "The path")
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-environments/v1/research/my-projects")
        .operation_id("studio_environments.list_my_research_projects")
        .summary("The Research projects the caller's own sign-in may run a project's product in")
        .description(
            "For `?project_id=`: the Constructor Research projects the caller's own sign-in \
             owns or collaborates on (ADR-0049 §1), and that connection's id -- what the deploy \
             dialog offers as Research targets and makes a project's own Research environment \
             with (#1053). Refused with `KIT_NOT_INSTALLED` where the Constructor Research kit \
             does not apply, `ENVIRONMENT_RESEARCH_NOT_SIGNED_IN` before the caller signs in.",
        )
        .tag(TAG)
        .authenticated()
        .require_license_features::<License>([])
        .query_param_typed("project_id", true, "The project", "string")
        .handler(list_my_research_projects)
        .json_response_with_schema::<MyResearchProjectListDto>(
            openapi,
            StatusCode::OK,
            "The Research projects",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    OperationBuilder::get(
        "/studio-environments/v1/research/my-projects/{research_project}/hardware",
    )
    .operation_id("studio_environments.list_my_research_hardware")
    .summary("The hardware one of the caller's Research projects may run on")
    .description(
        "For `?project_id=`: the hardware configurations of the Research project, read \
             with the caller's own sign-in, trial ones marked (#1053).",
    )
    .tag(TAG)
    .authenticated()
    .require_license_features::<License>([])
    .path_param("research_project", "The Research project's id")
    .query_param_typed("project_id", true, "The project", "string")
    .handler(list_my_research_hardware)
    .json_response_with_schema::<MyResearchHardwareListDto>(openapi, StatusCode::OK, "Its hardware")
    .error_400(openapi)
    .error_401(openapi)
    .error_404(openapi)
    .error_500(openapi)
    .register(router, openapi)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use uuid::Uuid;

    use crate::environments::model::{Deployment, DeploymentState};

    fn failed_research_deploy() -> Deployment {
        serde_json::from_value(json!({
            "id": Uuid::from_u128(0xd),
            "project_id": Uuid::from_u128(0x1),
            "project_name": "Shop",
            "environment_id": Uuid::from_u128(0xe),
            "environment_name": "Research",
            "profile": "kubernetes",
            "product": "shop",
            "namespace": "shop-research",
            "state": "failed",
            "requested_by": "ann",
            "requested_at": "2026-11-05T00:00:00Z",
            "outcome": "Research refused the service: GPU quota exceeded",
            "research": {
                "research_project": "rp-1",
                "repo": {
                    "tenant": Uuid::from_u128(1),
                    "connection_id": Uuid::from_u128(2),
                    "repo": "acme/shop",
                    "branch": "main"
                },
                "product_file": "product.gdl",
                "profile": "kubernetes",
                "commit": "abc1234"
            }
        }))
        .expect("a deployment")
    }

    #[test]
    fn the_inbox_item_of_a_failed_research_deploy_opens_that_deploy_with_its_cause() {
        let d = failed_research_deploy();
        let url = format!("/?screen=releases;org=o;project=p&deployment={}", d.id);
        let item = super::super::research_inbox_item(d.clone(), url.clone());
        assert_eq!(item.url.as_deref(), Some(url.as_str()));
        assert_eq!(item.deployment_id, Some(d.id.to_string()));
        let cause = item.cause.expect("a cause");
        assert_eq!(cause.code, "QUOTA_OR_HARDWARE_LIMIT");
        assert_eq!(cause.actions[0].kind, "choose_hardware");
        assert!(item.title.contains("quota"), "{}", item.title);
    }

    #[test]
    fn a_failed_deploy_carries_its_cause_and_a_research_one_its_kind() {
        let dto = super::super::deployment_dto(failed_research_deploy());
        assert!(dto.research);
        assert_eq!(dto.cause.expect("a cause").code, "QUOTA_OR_HARDWARE_LIMIT");
        let mut ok = failed_research_deploy();
        ok.state = DeploymentState::Succeeded;
        ok.outcome =
            Some("shop-research runs in Constructor Research: https://shop.example".into());
        let dto = super::super::deployment_dto(ok);
        assert!(dto.cause.is_none());
        assert_eq!(dto.public_url.as_deref(), Some("https://shop.example"));
    }
}
