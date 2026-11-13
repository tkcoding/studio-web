//! A project's creation as one background run, over REST: asked for here,
//! as the caller; carried out by `organizations.project_create`
//! ([`super::project_create`]) as this gear's service.
//!
//! - `POST /studio-organizations/v1/project-creations` -- check what the
//!   caller asks for as the routes that do each step would, approve the plan
//!   and queue it; 202 with the run.
//! - `GET /studio-organizations/v1/project-creations/{run_id}?organization_id=`
//!   -- where it stands: the run's state and each step's. The run is also in
//!   the organization's Background work (`GET /studio-tasks/v1/runs`) and its
//!   transitions are studio-events (`task.*`).

use std::sync::Arc;

use account_management_sdk::AccountManagementClient;
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::{Extension, Router};
use serde_json::{Map, Value, json};
use toolkit::api::canonical_prelude::*;
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit::client_hub::{ClientHub, ClientScope};
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::project_create::{
    KitPick, Plan, PrdPlan, Record, RepositoryPlan, ScaffoldPlan, SourcePick, TASK_TYPE,
};
use super::rest::OrganizationError;
use super::sdk::{ORGANIZATION_TENANT_TYPE, WORKSPACE_TENANT_TYPE};

/// What the routes need: account-management, and the hub for the task
/// queue and the connectors, resolved per request.
#[derive(Clone)]
pub struct Creations {
    pub am: Arc<dyn AccountManagementClient>,
    pub hub: Arc<ClientHub>,
}

/// One repository to take as a source.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ProjectSourceInput {
    pub connection_id: Uuid,
    /// `owner/name`.
    pub full_path: String,
    pub clone_url: String,
    pub default_branch: Option<String>,
}

/// The repository the project's gears go to.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ProjectRepositoryInput {
    /// `new` (made through the connection) or `existing`.
    pub mode: String,
    pub connection_id: Uuid,
    /// For `new`: its name, the account it goes under (the connection's own
    /// when absent), whether that account is an organization, and whether
    /// it is private (default true).
    pub name: Option<String>,
    pub owner: Option<String>,
    pub is_org: Option<bool>,
    pub private: Option<bool>,
    /// For `existing`.
    pub full_path: Option<String>,
    pub clone_url: Option<String>,
    pub default_branch: Option<String>,
}

/// A starter gear written into the repository.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct StarterGearInput {
    pub slug: String,
    /// `service` (default), `minimal` or `plugin`.
    pub gear_kind: Option<String>,
    /// Where under the repository it goes.
    pub parent_dir: Option<String>,
    /// For a plugin: the host gear and the extension point.
    pub plugin_host: Option<String>,
    pub plugin_spec: Option<String>,
    /// Open a pull request rather than commit onto a branch only.
    pub open_pr: Option<bool>,
}

/// A kit the project asks for.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ProjectKitInput {
    pub slug: String,
    /// The catalogue's default when absent.
    pub version: Option<String>,
}

/// A project to create.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct CreateProjectRequest {
    /// The workspace it goes under.
    pub workspace_id: Uuid,
    pub name: String,
    /// `greenfield` (default) or `modernize`.
    pub mode: Option<String>,
    /// What is being built, in the person's words: `project.config` `brief`,
    /// and the PRD's first answer.
    pub brief: Option<String>,
    /// The project type (`project.config` `type`).
    pub r#type: Option<String>,
    /// The owner's subject id; the caller when absent.
    pub owner_id: Option<String>,
    /// Repositories to take as the project's sources.
    pub sources: Option<Vec<ProjectSourceInput>>,
    pub repository: Option<ProjectRepositoryInput>,
    /// Needs `repository`.
    pub starter_gear: Option<StarterGearInput>,
    /// Write a PRD from the brief (default: when there is a brief and no
    /// starter gear, which writes its own).
    pub prd: Option<bool>,
    pub kits: Option<Vec<ProjectKitInput>>,
    /// The same key makes the same project once: a resend answers the run
    /// the first request queued.
    pub idempotency_key: Option<String>,
}

/// One step of a creation.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectCreationStepDto {
    /// `tenant`, `config`, `repository`, `sources`, `scaffold`, `prd` or `kits`.
    pub key: String,
    /// `pending`, `done` or `failed`.
    pub state: String,
    pub detail: Option<String>,
}

/// A creation and where it stands.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ProjectCreationDto {
    /// The studio-tasks run (`GET /studio-tasks/v1/runs/{id}?tenant=<organization_id>`).
    pub run_id: String,
    /// The project's tenant id, chosen when the run was asked for.
    pub project_id: String,
    pub organization_id: String,
    pub workspace_id: String,
    pub name: String,
    /// `queued`, `running`, `succeeded`, `failed` or `cancelled`.
    pub state: String,
    pub steps: Vec<ProjectCreationStepDto>,
    /// Why it stopped, when it did.
    pub error: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreationQuery {
    pub organization_id: Uuid,
}

fn invalid(field: &str, why: impl Into<String>) -> CanonicalError {
    OrganizationError::invalid_argument()
        .with_field_violation(field, why.into(), "INVALID")
        .create()
}

fn unavailable(what: &str) -> CanonicalError {
    CanonicalError::service_unavailable()
        .with_detail(what.to_string())
        .create()
}

/// The workspace as the caller reaches it, and its organization.
async fn workspace_and_org(
    am: &dyn AccountManagementClient,
    ctx: &SecurityContext,
    workspace: Uuid,
) -> ApiResult<Uuid> {
    let not_found = || {
        OrganizationError::not_found(format!("there is no workspace {workspace} for this caller"))
            .with_resource(workspace.to_string())
            .create()
    };
    let ws = am
        .get_tenant(ctx, workspace)
        .await
        .map_err(|_| not_found())?;
    if ws.tenant_type.as_deref() != Some(WORKSPACE_TENANT_TYPE) {
        return Err(not_found());
    }
    let org = ws.parent_id.map(|p| p.0).ok_or_else(not_found)?;
    let o = am.get_tenant(ctx, org).await.map_err(|_| not_found())?;
    if o.tenant_type.as_deref() != Some(ORGANIZATION_TENANT_TYPE) {
        return Err(not_found());
    }
    Ok(org)
}

/// A connection the caller may hand to the run: one they see from the
/// workspace, the organization's own, and not personal (a personal
/// connection's token is its owner's alone, and the run is not its owner).
/// The tenant that holds it.
async fn usable_connection(
    am: &dyn AccountManagementClient,
    ctx: &SecurityContext,
    workspace: Uuid,
    id: Uuid,
    field: &str,
) -> ApiResult<Uuid> {
    use crate::connectors::sdk::{check_owned, connection_by_id, holder_of_row};
    let (located, connection) =
        connection_by_id(am, ctx, workspace, id)
            .await
            .ok_or_else(|| {
                invalid(
                    field,
                    format!("there is no connection {id} you can use here"),
                )
            })?;
    if connection.scope == "personal" {
        return Err(invalid(
            field,
            "a personal connection cannot be used by a project's creation: it runs as Studio, \
             and a personal token is its owner's alone -- use one of the organization's",
        ));
    }
    let holder = holder_of_row(&connection, located);
    check_owned(am, ctx, workspace, holder, Some(holder))
        .await
        .map_err(|_| {
            OrganizationError::invalid_argument()
                .with_constraint(
                    "CONNECTION_NOT_OWNED: the connection is not the organization's own -- one \
                     inherited from the platform or held by another organization cannot be used",
                )
                .create()
        })?;
    Ok(holder)
}

/// The stages the workspace's catalogue marks required, read as the caller;
/// none when it cannot be read (creation does not fail on it).
async fn required_stages(headers: &HeaderMap, workspace: Uuid) -> Vec<Value> {
    let Some(api) = crate::mcp::api_as(headers.get(axum::http::header::AUTHORIZATION).cloned())
    else {
        return Vec::new();
    };
    let Ok(page) = api
        .get(
            &format!("/studio-documents/v1/workspaces/{workspace}/stages"),
            &[],
        )
        .await
    else {
        return Vec::new();
    };
    page.get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|s| s.get("required").and_then(Value::as_bool) == Some(true))
                .filter_map(|s| s.get("key").cloned())
                .collect()
        })
        .unwrap_or_default()
}

/// A slug as the scaffold takes it.
fn slug_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The plan, approved as the caller. Every check is the one the route that
/// does that step would make, so the run never does what the caller could
/// not have done themselves.
async fn approve(
    c: &Creations,
    ctx: &SecurityContext,
    headers: &HeaderMap,
    body: CreateProjectRequest,
) -> ApiResult<Plan> {
    let name = body.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(invalid(
            "name",
            "a project needs a name of at most 200 characters",
        ));
    }
    let organization_id = workspace_and_org(c.am.as_ref(), ctx, body.workspace_id).await?;
    let mode = body
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or("greenfield");
    if !matches!(mode, "greenfield" | "modernize") {
        return Err(invalid("mode", "must be greenfield or modernize"));
    }
    let brief = body
        .brief
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty());

    let mut sources = Vec::new();
    for (i, s) in body.sources.unwrap_or_default().into_iter().enumerate() {
        let field = format!("sources[{i}].connection_id");
        let holder = usable_connection(
            c.am.as_ref(),
            ctx,
            body.workspace_id,
            s.connection_id,
            &field,
        )
        .await?;
        if s.full_path.trim().is_empty() || s.clone_url.trim().is_empty() {
            return Err(invalid(
                &format!("sources[{i}]"),
                "needs full_path and clone_url",
            ));
        }
        sources.push(SourcePick {
            connection_id: s.connection_id,
            holder,
            full_path: s.full_path.trim().to_string(),
            clone_url: s.clone_url.trim().to_string(),
            branch: s.default_branch.filter(|b| !b.trim().is_empty()),
        });
    }
    if sources.len() > 100 {
        return Err(invalid("sources", "at most 100 repositories"));
    }

    let repository = match body.repository {
        None => None,
        Some(r) => {
            let holder = usable_connection(
                c.am.as_ref(),
                ctx,
                body.workspace_id,
                r.connection_id,
                "repository.connection_id",
            )
            .await?;
            match r.mode.as_str() {
                "new" if r.name.as_deref().is_some_and(slug_ok) => {}
                "new" => {
                    return Err(invalid(
                        "repository.name",
                        "a new repository needs a name: letters, digits, - and _",
                    ));
                }
                "existing" if r.full_path.as_deref().is_some_and(|p| p.contains('/')) => {}
                "existing" => {
                    return Err(invalid(
                        "repository.full_path",
                        "an existing repository is named owner/name",
                    ));
                }
                _ => return Err(invalid("repository.mode", "must be new or existing")),
            }
            Some(RepositoryPlan {
                connection_id: r.connection_id,
                holder,
                mode: r.mode,
                name: r.name,
                owner: r.owner.filter(|o| !o.trim().is_empty()),
                is_org: r.is_org.unwrap_or(false),
                private: r.private.unwrap_or(true),
                full_path: r.full_path,
                clone_url: r.clone_url,
                default_branch: r.default_branch,
            })
        }
    };

    let scaffold = match body.starter_gear {
        None => None,
        Some(_) if repository.is_none() => {
            return Err(invalid(
                "starter_gear",
                "a starter gear needs a repository to go into",
            ));
        }
        Some(g) if !slug_ok(&g.slug) => {
            return Err(invalid("starter_gear.slug", "letters, digits, - and _"));
        }
        Some(g) => {
            let kind = g.gear_kind.unwrap_or_else(|| "service".to_string());
            if !matches!(kind.as_str(), "service" | "minimal" | "plugin") {
                return Err(invalid(
                    "starter_gear.gear_kind",
                    "must be service, minimal or plugin",
                ));
            }
            if kind == "plugin" && (g.plugin_host.is_none() || g.plugin_spec.is_none()) {
                return Err(invalid(
                    "starter_gear",
                    "a plugin names its host and extension point",
                ));
            }
            Some(ScaffoldPlan {
                slug: g.slug,
                app_title: Some(name.clone()),
                problem: brief.map(str::to_string),
                parent_dir: g.parent_dir,
                gear_kind: Some(kind),
                plugin_host: g.plugin_host,
                plugin_spec: g.plugin_spec,
                open_pr: g.open_pr.unwrap_or(false),
            })
        }
    };

    // A PRD from the brief, unless a starter gear writes its own.
    let prd = match (brief, body.prd.unwrap_or(scaffold.is_none())) {
        (Some(answer), true) => Some(PrdPlan {
            title: name.clone(),
            answer: answer.to_string(),
        }),
        _ => None,
    };

    let mut kits = Vec::new();
    for (i, k) in body.kits.unwrap_or_default().into_iter().enumerate() {
        if !slug_ok(&k.slug) {
            return Err(invalid(
                &format!("kits[{i}].slug"),
                "letters, digits, - and _",
            ));
        }
        if !kits.iter().any(|x: &KitPick| x.slug == k.slug) {
            kits.push(KitPick {
                slug: k.slug,
                version: k.version.filter(|v| !v.trim().is_empty()),
            });
        }
    }

    let mut config = Map::new();
    config.insert("mode".into(), json!(mode));
    config.insert("status".into(), json!("draft"));
    config.insert(
        "stages".into(),
        Value::Array(required_stages(headers, body.workspace_id).await),
    );
    if let Some(b) = brief {
        config.insert("brief".into(), json!(b));
    }
    if let Some(t) = body
        .r#type
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        config.insert("type".into(), json!(t));
    }
    let owner = body
        .owner_id
        .filter(|o| !o.trim().is_empty())
        .unwrap_or_else(|| ctx.subject_id().to_string());
    config.insert("owner_id".into(), json!(owner));

    // The same key, the same project: a resend finds the tenant and the run.
    let project_id = match body.idempotency_key.as_deref().filter(|k| !k.is_empty()) {
        Some(key) => Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!(
                "studio:project-create:{}:{}:{key}",
                ctx.subject_id(),
                body.workspace_id
            )
            .as_bytes(),
        ),
        None => Uuid::new_v4(),
    };
    Ok(Plan {
        asked_by: ctx.subject_id(),
        organization_id,
        workspace_id: body.workspace_id,
        project_id,
        name,
        config,
        sources,
        repository,
        scaffold,
        prd,
        kits,
    })
}

fn queue(hub: &ClientHub) -> ApiResult<Arc<dyn crate::tasks::TaskQueue>> {
    hub.get_scoped::<dyn crate::tasks::TaskQueue>(&ClientScope::gts_id(
        crate::tasks::TASK_QUEUE_INSTANCE_ID,
    ))
    .map_err(|_| unavailable("studio-tasks is not running here, so nothing can be queued"))
}

fn steps_dto(steps: Vec<super::project_create::StepRecord>) -> Vec<ProjectCreationStepDto> {
    steps
        .into_iter()
        .map(|s| ProjectCreationStepDto {
            key: s.key,
            state: s.state,
            detail: s.detail,
        })
        .collect()
}

async fn create_project(
    Extension(ctx): Extension<SecurityContext>,
    Extension(c): Extension<Option<Creations>>,
    headers: HeaderMap,
    Json(body): Json<CreateProjectRequest>,
) -> ApiResult<(StatusCode, JsonBody<ProjectCreationDto>)> {
    let c = c.ok_or_else(|| unavailable("account-management is not available here"))?;
    let key = body.idempotency_key.clone().filter(|k| !k.is_empty());
    let plan = approve(&c, &ctx, &headers, body).await?;
    let queue = queue(&c.hub)?;
    let project = plan.project_id.to_string();
    let idempotency = key.map(|k| format!("{TASK_TYPE}:{}:{k}", plan.project_id));
    let payload = serde_json::to_value(&plan)
        .map_err(|e| CanonicalError::internal(e.to_string()).create())?;
    let run_id = queue
        .enqueue(
            &ctx,
            crate::tasks::sdk::NewRun {
                tenant: plan.organization_id,
                task_type: TASK_TYPE,
                payload,
                partition_key: Some(&project),
                idempotency_key: idempotency.as_deref(),
                coalesce_queued: false,
                notify_workspace_id: None,
            },
        )
        .await
        .map_err(|e| unavailable(&format!("the creation could not be queued: {e:#}")))?;
    // The same key again after the run gave up: the person asks for the same
    // project, so the run goes back on the queue and continues where it
    // stopped. A run still working, or done, is answered as it is.
    let mut state = "queued".to_string();
    let mut record = Record::resume(&plan, None);
    if idempotency.is_some()
        && let Ok(Some(view)) = queue.run(plan.organization_id, run_id).await
    {
        if let Some(r) = view
            .result
            .as_ref()
            .and_then(|v| serde_json::from_value::<Record>(v.clone()).ok())
        {
            record = r;
        }
        state = view.state.as_str().to_string();
        if matches!(state.as_str(), "failed" | "cancelled") {
            queue
                .retry(plan.organization_id, run_id)
                .await
                .map_err(|e| unavailable(&format!("the creation could not be retried: {e:#}")))?;
            state = "queued".to_string();
        }
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(ProjectCreationDto {
            run_id: run_id.to_string(),
            project_id: project,
            organization_id: plan.organization_id.to_string(),
            workspace_id: plan.workspace_id.to_string(),
            name: plan.name.clone(),
            state,
            steps: steps_dto(record.steps),
            error: None,
        }),
    ))
}

async fn get_project_creation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(c): Extension<Option<Creations>>,
    Path(run_id): Path<Uuid>,
    Query(q): Query<CreationQuery>,
) -> ApiResult<JsonBody<ProjectCreationDto>> {
    let c = c.ok_or_else(|| unavailable("account-management is not available here"))?;
    let not_found = || {
        OrganizationError::not_found(format!("there is no project creation {run_id}"))
            .with_resource(run_id.to_string())
            .create()
    };
    // Whoever reaches the organization reads its background work.
    c.am.get_tenant(&ctx, q.organization_id)
        .await
        .map_err(|_| not_found())?;
    let view = queue(&c.hub)?
        .run(q.organization_id, run_id)
        .await
        .map_err(|e| unavailable(&format!("the run could not be read: {e:#}")))?
        .ok_or_else(not_found)?;
    // A run's result is its record once it started; before that, nothing.
    let record = view
        .result
        .as_ref()
        .and_then(|v| serde_json::from_value::<Record>(v.clone()).ok());
    let state = view.state.as_str().to_string();
    let Some(record) = record else {
        if state == "queued" {
            return Ok(Json(ProjectCreationDto {
                run_id: run_id.to_string(),
                project_id: String::new(),
                organization_id: q.organization_id.to_string(),
                workspace_id: String::new(),
                name: String::new(),
                state,
                steps: Vec::new(),
                error: view.last_error,
            }));
        }
        return Err(not_found());
    };
    if record.organization_id != q.organization_id {
        return Err(not_found());
    }
    Ok(Json(ProjectCreationDto {
        run_id: run_id.to_string(),
        project_id: record.project_id.to_string(),
        organization_id: record.organization_id.to_string(),
        workspace_id: record.workspace_id.to_string(),
        name: record.name,
        state,
        steps: steps_dto(record.steps),
        error: view.last_error,
    }))
}

pub fn register(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    creations: Option<Creations>,
) -> Router {
    let router = OperationBuilder::post("/studio-organizations/v1/project-creations")
        .operation_id("studio_organizations.create_project")
        .summary("Create a project, as one background run")
        .description(
            "Checks what the caller asks for as the routes that do each step would -- the \
             caller reaches the workspace, every connection is one they can use from it, the \
             organization's own and not personal -- and queues one studio-tasks run \
             (`organizations.project_create`) in the organization that creates the project \
             tenant (its id chosen now and answered), writes its `project.config` (mode, brief, \
             owner, status, the workspace's required stages, the sources), makes or attaches \
             the repository its gears go to, writes a starter gear, a PRD from the brief and \
             asks for the kits. The run acts as Studio, scoped to the organization and the new \
             project; `asked_by` is recorded. Each step is recorded as it ends and a retry \
             (`POST /studio-tasks/v1/runs/{id}/retry`) continues where it stopped. Progress is \
             `GET project-creations/{run_id}`, the organization's Background work, and \
             `task.*` studio-events. The same `idempotency_key` makes the same project once.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<super::rest::License>([])
        .handler(create_project)
        .json_request::<CreateProjectRequest>(openapi, "The project")
        .json_response_with_schema::<ProjectCreationDto>(openapi, StatusCode::ACCEPTED, "Queued")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-organizations/v1/project-creations/{run_id}")
        .operation_id("studio_organizations.get_project_creation")
        .summary("Where a project's creation stands")
        .description(
            "The run's state (`queued`, `running`, `succeeded`, `failed`, `cancelled`), each \
             step's (`pending`, `done`, `failed`) with a line on what it did, the project's id \
             and why it stopped. Read by whoever reaches the organization, as its Background \
             work is.",
        )
        .tag("StudioOrganizations")
        .authenticated()
        .require_license_features::<super::rest::License>([])
        .path_param("run_id", "The run `POST project-creations` answered")
        .query_param(
            "organization_id",
            true,
            "The organization the project is created in",
        )
        .handler(get_project_creation)
        .json_response_with_schema::<ProjectCreationDto>(openapi, StatusCode::OK, "Where it stands")
        .error_400(openapi)
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .error_503(openapi)
        .register(router, openapi);

    router.layer(Extension(creations))
}

#[cfg(test)]
mod tests {
    use super::super::project_create::steps_of;
    use super::*;

    #[test]
    fn a_slug_is_letters_digits_dashes_and_underscores() {
        assert!(slug_ok("orders-api_2"));
        assert!(!slug_ok(""));
        assert!(!slug_ok("a/b"));
        assert!(!slug_ok(&"x".repeat(65)));
    }

    #[test]
    fn a_plan_is_its_steps_in_the_answer_before_it_runs() {
        let plan = Plan {
            asked_by: Uuid::nil(),
            organization_id: Uuid::nil(),
            workspace_id: Uuid::nil(),
            project_id: Uuid::nil(),
            name: "x".into(),
            config: Map::new(),
            sources: Vec::new(),
            repository: None,
            scaffold: None,
            prd: None,
            kits: Vec::new(),
        };
        let steps = steps_dto(Record::resume(&plan, None).steps);
        let keys: Vec<&str> = steps.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, steps_of(&plan));
        assert!(steps.iter().all(|s| s.state == "pending"));
    }
}
