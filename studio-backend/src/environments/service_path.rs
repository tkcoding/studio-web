//! A project's path to running (#1050) read in one go, and the caller's own
//! Constructor Research projects and hardware for the one deploy dialog
//! (#1053).

use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::{EnvironmentService, RESEARCH_SIGN_IN_WARN_DAYS, Refusal, Result, sign_in_due};
use crate::connectors::sdk as connectors;
use crate::environments::model::EnvironmentKind;
use crate::environments::path::{self, PathEnvironment, PathFacts, ProjectPath, SignInState};

/// How many builds the path reads: the newest, and the newest that passed
/// among them.
const PATH_BUILDS: usize = 50;

/// The caller's own Constructor Research sign-in, as the deploy dialog shows
/// it (#1053).
#[derive(Debug, Clone)]
pub struct ResearchSignIn {
    /// The caller's own `research` connection, when they signed in.
    pub connection_id: Option<Uuid>,
    pub state: SignInState,
}

/// The path, and what it was decided about.
#[derive(Debug, Clone)]
pub struct PathView {
    pub organization_id: Uuid,
    pub path: ProjectPath,
    /// Whether the Constructor Research kit applies to the project: without
    /// it, no Research target is offered.
    pub research_kit: bool,
    /// The caller's sign-in; `None` where the kit does not apply.
    pub research: Option<ResearchSignIn>,
}

impl EnvironmentService {
    /// The caller's own Research sign-in, looked for as a build or deploy
    /// would look for it (the project, then the organization, then their own
    /// tenant), and whether it runs out.
    async fn research_sign_in(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        project: Uuid,
    ) -> ResearchSignIn {
        let am = self.store.am().as_ref();
        let from = [project, org, ctx.subject_tenant_id()];
        let Some((_, c)) =
            connectors::own_connection(am, ctx, &from, connectors::RESEARCH_PROVIDER).await
        else {
            return ResearchSignIn {
                connection_id: None,
                state: SignInState::None,
            };
        };
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let state = match sign_in_due(
            c.id,
            c.created_at_epoch_secs,
            now,
            connectors::RESEARCH_KEY_LIFETIME_DAYS,
            RESEARCH_SIGN_IN_WARN_DAYS,
        ) {
            None => SignInState::SignedIn,
            Some(due) if due.days_left == 0 => SignInState::Expired,
            Some(due) => SignInState::RunsOut(due.days_left),
        };
        ResearchSignIn {
            connection_id: Some(c.id),
            state,
        }
    }

    /// Where `project` stands on its way from a product to running.
    pub async fn project_path(&self, ctx: &SecurityContext, project: Uuid) -> Result<PathView> {
        let targets = self.targets(ctx, project).await?;
        let org = targets.organization_id;
        let research_kit = self.research_kit_applies(ctx, project).await?;
        let research = if research_kit {
            Some(self.research_sign_in(ctx, org, project).await)
        } else {
            None
        };

        let builds = match self
            .hub
            .get::<dyn crate::artifact_ingest::port::BuildRecords>()
        {
            Ok(records) => records
                .builds(ctx, &project.to_string(), PATH_BUILDS)
                .await
                .map_err(|e| Refusal::Internal(format!("the builds could not be read: {e:#}")))?,
            Err(_) => Vec::new(),
        };
        let product_revision = match self.hub.get::<dyn crate::product::port::ProjectProducts>() {
            Ok(products) => {
                let latest = products
                    .latest_description(ctx, project)
                    .await
                    .map_err(|e| {
                        Refusal::Internal(format!(
                            "the product description could not be read: {e:#}"
                        ))
                    })?;
                match latest {
                    Some(d) => Some(d.revision.max(1)),
                    None => products
                        .saved_description(ctx, &project.to_string())
                        .await
                        .ok()
                        .flatten()
                        .map(|_| 0),
                }
            }
            Err(_) => None,
        };
        // A product built before Studio kept its description is one.
        let product_revision = product_revision.or((!builds.is_empty()).then_some(0));

        let mut environments: Vec<PathEnvironment> = targets
            .environments
            .into_iter()
            .filter(|(e, _)| research_kit || e.kind != EnvironmentKind::Research)
            .map(|(env, _namespace)| PathEnvironment {
                bound: targets.bindings.iter().any(|b| b.environment_id == env.id),
                env,
                missing_secrets: Vec::new(),
            })
            .collect();
        let deployments = self.deployments(ctx, org, Some(project), None).await?;
        // The secrets are read for the environment the path is about only:
        // each read reads the description.
        if let Some(target) = path::target_environment(&environments, &deployments)
            && let Ok(keys) = self.secret_keys(ctx, project, target).await
            && let Some(e) = environments.iter_mut().find(|e| e.env.id == target)
        {
            e.missing_secrets = keys
                .needed
                .iter()
                .filter(|n| n.missing())
                .map(|n| n.key.clone())
                .collect();
        }
        let facts = PathFacts {
            product_revision,
            builds,
            environments,
            deployments,
            research_kit,
            sign_in: research.as_ref().map_or(SignInState::None, |r| r.state),
        };
        Ok(PathView {
            organization_id: org,
            path: path::project_path(&facts),
            research_kit,
            research,
        })
    }

    /// The Research projects the caller's own sign-in may run `project`'s
    /// product in: what the deploy dialog offers as Research targets (#1053).
    /// Refused without the kit, and without a sign-in.
    pub async fn my_research_projects(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
    ) -> Result<(Uuid, Vec<connectors::research::Project>)> {
        let org = self.organization_of_project(ctx, project).await?;
        self.require_research_kit(ctx, project).await?;
        let sign_in = self.own_research(ctx, org, Some(project)).await?;
        let projects = self
            .research_api(ctx, sign_in.tenant, sign_in.connection_id)
            .await?
            .projects()
            .await
            .map_err(|e| {
                Refusal::Precondition("ENVIRONMENT_RESEARCH_UNREACHABLE", format!("{e:#}"))
            })?;
        Ok((sign_in.connection_id, projects))
    }

    /// The hardware of one of the caller's Research projects.
    pub async fn my_research_hardware(
        &self,
        ctx: &SecurityContext,
        project: Uuid,
        research_project: &str,
    ) -> Result<Vec<connectors::research::Hardware>> {
        let org = self.organization_of_project(ctx, project).await?;
        self.require_research_kit(ctx, project).await?;
        self.own_research_api(ctx, org, Some(project))
            .await?
            .hardware(research_project)
            .await
            .map_err(|e| {
                Refusal::Precondition("ENVIRONMENT_RESEARCH_UNREACHABLE", format!("{e:#}"))
            })
    }

    /// Where the portal opens one of `project`'s deploys: Project › Releases
    /// with the deploy named (the shell keeps the foreign `deployment`
    /// parameter for the screen). The project's workspace is its parent.
    pub async fn deployment_link(
        &self,
        ctx: &SecurityContext,
        org: Uuid,
        project: Uuid,
        deployment: Uuid,
    ) -> String {
        let am = self.store.am().as_ref();
        let workspace = am
            .get_tenant(ctx, project)
            .await
            .ok()
            .and_then(|t| t.parent_id.map(|p| p.0))
            .filter(|w| *w != org);
        let workspace = workspace
            .map(|w| format!(";workspace={w}"))
            .unwrap_or_default();
        format!("/?screen=releases;org={org}{workspace};project={project}&deployment={deployment}")
    }
}
