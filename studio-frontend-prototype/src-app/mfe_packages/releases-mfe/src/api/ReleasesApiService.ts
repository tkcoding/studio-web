/**
 * What Project › Releases reads and writes (ported from the prototype's
 * client, ADR-0069 §5): where the project may deploy, its deploys and the
 * decisions on them, previews, a release's chart values and secrets, a
 * Studio build's log (all `studio-environments`, ADR-0043/0045/0048/0055);
 * the builds, CI runs and repositories the artifact sync keeps, and Build in
 * CI (`studio-artifact-ingest`); a deploy's run (`studio-tasks`); the
 * project config's build workflow and the tenants' users, to name people
 * (`account-management`).
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type {
  ArtifactNodePage,
  BuildLog,
  ConfigSecret,
  Connection,
  Deployment,
  DeploymentList,
  DeploymentRequest,
  DeploymentStatus,
  EnvironmentBinding,
  EnvironmentList,
  Items,
  ProjectBuildConfig,
  ProjectImage,
  ProjectTargets,
  TaskRun,
  UserPage,
  DeployEnvironment,
  DeployEnvironmentInput,
  DeploymentLogs,
  EnvironmentBuild,
  MappingPlanSummary,
  MyResearchProjects,
  ProjectPath,
  ResearchHardware,
  StudioBuildStarted,
} from './types';

const ENV = '/studio-environments/v1';
const enc = encodeURIComponent;
const project = (projectId: string) => `project_id=${enc(projectId)}`;
const org = (organizationId: string) => `organization_id=${enc(organizationId)}`;

/** Project attributes live in this tenant-metadata type (the prototype's PROJECT_CONFIG_TYPE). */
const PROJECT_CONFIG = 'gts.cf.core.am.tenant_metadata.v1~cf.studio.project.config.v1~';

export interface ProjectParams {
  projectId: string;
}

export interface NodesParams extends ProjectParams {
  /** `build`, `workflow_run`, `repo`. */
  type: string;
  limit: number;
  sort?: 'updated';
}

export class ReleasesApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── studio-environments ── */

  /** Where the project's product can be deployed: the environments, the bindings, the secret keys. */
  readonly targets = this.protocol(RestEndpointProtocol).queryWith<ProjectTargets, ProjectParams>(
    ({ projectId }) => `${ENV}/targets?${project(projectId)}`
  );

  /** Where the project stands from its product to running, one read (#1050). */
  readonly projectPath = this.protocol(RestEndpointProtocol).queryWith<ProjectPath, ProjectParams>(
    ({ projectId }) => `${ENV}/project-path?${project(projectId)}`
  );

  /** One deploy, with its cause when it failed. */
  readonly deployment = this.protocol(RestEndpointProtocol).queryWith<Deployment, ProjectParams & { id: string }>(
    ({ projectId, id }) => `${ENV}/deployments/${enc(id)}?${project(projectId)}`
  );

  /** The end of a deploy's logs: its containers', or its Research services'. */
  readonly deploymentLogs = this.protocol(RestEndpointProtocol).queryWith<
    DeploymentLogs,
    { organizationId: string; id: string }
  >(({ organizationId, id }) => `${ENV}/deployments/${enc(id)}/logs?${org(organizationId)}`);

  /** One build as Studio keeps it, with its cause when it failed. */
  readonly build = this.protocol(RestEndpointProtocol).queryWith<EnvironmentBuild, ProjectParams & { buildId: string }>(
    ({ projectId, buildId }) => `${ENV}/builds/${enc(buildId)}?${project(projectId)}`
  );

  /** Build the product in an environment: its cluster, or Constructor Research. */
  startBuild(projectId: string) {
    return this.rest.mutation<StudioBuildStarted, { environment_id: string }>('POST', `${ENV}/builds?${project(projectId)}`);
  }

  /** The caller's own Research projects (#1053); refused without the kit or a sign-in. */
  readonly myResearchProjects = this.protocol(RestEndpointProtocol).queryWith<MyResearchProjects, ProjectParams>(
    ({ projectId }) => `${ENV}/research/my-projects?${project(projectId)}`
  );

  readonly myResearchHardware = this.protocol(RestEndpointProtocol).queryWith<
    { items: ResearchHardware[]; total: number },
    ProjectParams & { researchProject: string }
  >(({ projectId, researchProject }) => `${ENV}/research/my-projects/${enc(researchProject)}/hardware?${project(projectId)}`);

  /** Add one of the project's own environments: a Research one runs on the caller's sign-in. */
  createProjectEnvironment(projectId: string) {
    return this.rest.mutation<DeployEnvironment, DeployEnvironmentInput>(
      'POST',
      `${ENV}/project-environments?${project(projectId)}`
    );
  }

  /** What the project's specifications need (studio-spec-mapping): the Specs step reads its size. */
  readonly specPlan = this.protocol(RestEndpointProtocol).queryWith<MappingPlanSummary, ProjectParams>(
    ({ projectId }) => `/studio-spec-mapping/v1/plan?${project(projectId)}`
  );

  /** The project's deploys, newest first. */
  readonly deployments = this.protocol(RestEndpointProtocol).queryWith<DeploymentList, ProjectParams>(
    ({ projectId }) => `${ENV}/deployments?${project(projectId)}`
  );

  /** Ask for a deploy: queued, or waiting for an administrator in a protected environment. */
  createDeployment(projectId: string) {
    return this.rest.mutation<Deployment, DeploymentRequest>('POST', `${ENV}/deployments?${project(projectId)}`);
  }

  /** The organization's environments: read here only for `may_manage`, whether the caller decides deploys. */
  readonly environments = this.protocol(RestEndpointProtocol).queryWith<EnvironmentList, { organizationId: string }>(
    ({ organizationId }) => `${ENV}/environments?${org(organizationId)}`
  );

  /** Approve or decline a deploy to a protected environment. */
  decideDeployment(organizationId: string, id: string) {
    return this.rest.mutation<Deployment, { action: 'approve' | 'decline'; reason?: string }>(
      'POST',
      `${ENV}/deployments/${enc(id)}/decisions?${org(organizationId)}`
    );
  }

  /** The release's workloads and hosts, read from its cluster now. */
  readonly deploymentStatus = this.protocol(RestEndpointProtocol).queryWith<
    DeploymentStatus,
    { organizationId: string; id: string }
  >(({ organizationId, id }) => `${ENV}/deployments/${enc(id)}/status?${org(organizationId)}`);

  /** Take a preview out (ADR-0055): its namespace goes, with everything in it. */
  removePreview(projectId: string, deploymentId: string) {
    return this.rest.mutation<{ run_id: string }, void>('DELETE', `${ENV}/previews/${enc(deploymentId)}?${project(projectId)}`);
  }

  /** Save the project's bindings: which profile each environment runs, with its chart values. */
  saveBindings(projectId: string) {
    return this.rest.mutation<{ items: EnvironmentBinding[]; total: number }, { items: EnvironmentBinding[] }>(
      'PUT',
      `${ENV}/bindings?${project(projectId)}`
    );
  }

  /** Set a secret of the project's configuration in an environment; the value never comes back. */
  setConfigSecret(projectId: string, environmentId: string, key: string) {
    return this.rest.mutation<ConfigSecret, { value: string }>(
      'PUT',
      `${ENV}/config-secrets/${enc(key)}?${project(projectId)}&environment_id=${enc(environmentId)}`
    );
  }

  deleteConfigSecret(projectId: string, environmentId: string, key: string) {
    return this.rest.mutation<void, void>(
      'DELETE',
      `${ENV}/config-secrets/${enc(key)}?${project(projectId)}&environment_id=${enc(environmentId)}`
    );
  }

  /** A build Studio runs, step by step, read from its pod now; 404 once the pod is gone. */
  readonly buildLog = this.protocol(RestEndpointProtocol).queryWith<BuildLog, ProjectParams & { buildId: string }>(
    ({ projectId, buildId }) => `${ENV}/builds/${enc(buildId)}/log?${project(projectId)}`
  );

  /** The images a build put in registries, as Studio recorded them. */
  readonly buildImages = this.protocol(RestEndpointProtocol).queryWith<
    { items: ProjectImage[]; total: number },
    ProjectParams & { buildId: string }
  >(({ projectId, buildId }) => `${ENV}/images?${new URLSearchParams({ project_id: projectId, build_id: buildId })}`);

  /* ── studio-product ── */

  /** The product's description Studio keeps: its latest revision's text names the profiles. */
  readonly productDescription = this.protocol(RestEndpointProtocol).queryWith<
    { latest?: { text?: string | null } | null },
    ProjectParams
  >(({ projectId }) => `/studio-product/v1/product-description?${project(projectId)}`);

  /* ── studio-artifact-ingest ── */

  /** The artifact sync's nodes of one type in the project: builds, CI runs, repositories. */
  readonly nodes = this.protocol(RestEndpointProtocol).queryWith<ArtifactNodePage, NodesParams>(
    ({ projectId, type, limit, sort }) => {
      const qs = new URLSearchParams({ type, scope: projectId });
      if (sort) qs.set('sort', sort);
      qs.set('limit', String(limit));
      return `/studio-artifact-ingest/v1/nodes?${qs}`;
    }
  );

  /** Build in CI (ADR-0045 phase 3): start the workflow named, on a ref or the repository's branch. */
  dispatchBuild(projectId: string) {
    return this.rest.mutation<
      { repo: string; workflow: string; ref: string },
      { repo?: string; workflow?: string; ref?: string }
    >('POST', `/studio-artifact-ingest/v1/builds/dispatch?${project(projectId)}`);
  }

  /* ── studio-tasks: a deploy's run ── */

  readonly taskRun = this.protocol(RestEndpointProtocol).queryWith<TaskRun, { runId: string; tenantId: string }>(
    ({ runId, tenantId }) => `/studio-tasks/v1/runs/${enc(runId)}?tenant=${enc(tenantId)}`
  );

  /* ── studio-connector: the places a rung stands on ── */

  /** Connections visible from the project: its own, or inherited. */
  readonly connections = this.protocol(RestEndpointProtocol).queryWith<Items<Connection>, { tenantId: string }>(
    ({ tenantId }) => `/studio-connector/v1/connections?tenant=${enc(tenantId)}`
  );

  /* ── account-management ── */

  /** The project's config (tenant metadata); 404 when nobody wrote it. */
  readonly projectConfig = this.protocol(RestEndpointProtocol).queryWith<{ value: ProjectBuildConfig }, ProjectParams>(
    ({ projectId }) => `/account-management/v1/tenants/${enc(projectId)}/metadata/${PROJECT_CONFIG}`
  );

  /** Write the whole config back: the caller merges, the metadata is one object. */
  putProjectConfig(projectId: string) {
    return this.rest.mutation<unknown, ProjectBuildConfig>(
      'PUT',
      `/account-management/v1/tenants/${enc(projectId)}/metadata/${PROJECT_CONFIG}`
    );
  }

  readonly tenantUsers = this.protocol(RestEndpointProtocol).queryWith<UserPage, { tenantId: string; cursor?: string }>(
    ({ tenantId, cursor }) => {
      const qs = new URLSearchParams({ limit: '200' });
      if (cursor) qs.set('cursor', cursor);
      return `/account-management/v1/tenants/${enc(tenantId)}/users?${qs}`;
    }
  );
}
