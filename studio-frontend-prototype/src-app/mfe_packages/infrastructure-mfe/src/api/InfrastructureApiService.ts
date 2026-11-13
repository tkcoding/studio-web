/**
 * What Organization › Infrastructure reads and writes (ported from the
 * prototype's client, ADR-0069 §5): the organization's environments, the
 * clusters it opens to its projects, its deploys and their decisions, a
 * release's status and logs, a cluster's readiness, the namespaces projects
 * were given, the image retention and the registries' contents — all
 * `studio-environments` (ADR-0043); the places themselves, which are
 * `studio-connector` connections; and the tenants' users, to name people.
 */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestPlugin,
  RestProtocol,
  type RestRequestContext,
} from '@gears-frontx/react';
import type {
  ConnectionTest,
  ContainerLog,
  Connection,
  DeployEnvironment,
  DeployEnvironmentInput,
  Deployment,
  DeploymentList,
  DeploymentStatus,
  EnvironmentList,
  EnvironmentReadiness,
  ImageRetention,
  InstalledKits,
  Items,
  NamespaceAssignment,
  OrgRegistry,
  RegistryOrphan,
  RegistryRepository,
  RegistryTag,
  ResearchHardware,
  ResearchProject,
  UserPage,
} from './types';

const ENV = '/studio-environments/v1';
const enc = encodeURIComponent;
const org = (organizationId: string) => `organization_id=${enc(organizationId)}`;

/** Deleting a registry version starts background work: the request a lost answer must not repeat. */
const startsDeletion = (url: string) => /\/registries\/[^/]+\/repositories\/[^/]+\/versions\//.test(url);

/**
 * `Idempotency-Key` on a registry version's DELETE (docs/api-conventions.md
 * D1), as the prototype sent it: a retried request answers the run the first
 * one started. A plugin, because the FrontX mutation descriptor takes no headers.
 */
class DeletionIdempotencyPlugin extends RestPlugin {
  onRequest(context: RestRequestContext): RestRequestContext {
    if (context.method !== 'DELETE' || !startsDeletion(context.url) || context.headers['Idempotency-Key'] !== undefined) {
      return context;
    }
    return { ...context, headers: { ...context.headers, 'Idempotency-Key': crypto.randomUUID() } };
  }
}

export interface OrgParams {
  organizationId: string;
}

export interface ResearchParams extends OrgParams {
  connectionId: string;
}

export interface RegistryParams extends OrgParams {
  connectionId: string;
}

export class InfrastructureApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
    restProtocol.plugins.add(new DeletionIdempotencyPlugin());
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── studio-kits ── */

  /** The kits that apply to the organization (ADR-0069 §4): Research places
   *  come with the Constructor Research kit (docs/design/studio-kits.md §3.13). */
  readonly installedKits = this.protocol(RestEndpointProtocol).queryWith<InstalledKits, OrgParams>(
    ({ organizationId }) => `/studio-kits/v1/installed-kits?${org(organizationId)}`
  );

  /* ── studio-environments ── */

  /** The organization's environments, and whether the caller may change them. */
  readonly environments = this.protocol(RestEndpointProtocol).queryWith<EnvironmentList, OrgParams>(
    ({ organizationId }) => `${ENV}/environments?${org(organizationId)}`
  );

  /** Say which of the organization's clusters its projects may use (ADR-0054 §2). */
  saveOpenClusters(organizationId: string) {
    return this.rest.mutation<{ connection_ids: string[] }, { connection_ids: string[] }>(
      'PUT',
      `${ENV}/open-clusters?${org(organizationId)}`
    );
  }

  createEnvironment(organizationId: string) {
    return this.rest.mutation<DeployEnvironment, DeployEnvironmentInput>('POST', `${ENV}/environments?${org(organizationId)}`);
  }

  updateEnvironment(organizationId: string, id: string) {
    return this.rest.mutation<DeployEnvironment, DeployEnvironmentInput>(
      'PUT',
      `${ENV}/environments/${enc(id)}?${org(organizationId)}`
    );
  }

  deleteEnvironment(organizationId: string, id: string) {
    return this.rest.mutation<void, void>('DELETE', `${ENV}/environments/${enc(id)}?${org(organizationId)}`);
  }

  /** Reach the environment's cluster with its connection; nothing is changed there. */
  testEnvironment(organizationId: string, id: string) {
    return this.rest.mutation<{ message: string }, void>('POST', `${ENV}/environments/${enc(id)}/test?${org(organizationId)}`);
  }

  /** Whether the environment's cluster is ready for Studio, read from it now. */
  readonly environmentReadiness = this.protocol(RestEndpointProtocol).queryWith<
    EnvironmentReadiness,
    { environmentId: string; organizationId?: string; projectId?: string }
  >(({ environmentId, organizationId, projectId }) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set('project_id', projectId);
    else if (organizationId) qs.set('organization_id', organizationId);
    return `${ENV}/environments/${enc(environmentId)}/readiness?${qs}`;
  });

  /** The Research projects an organization's `research` connection may run products in. */
  readonly researchProjects = this.protocol(RestEndpointProtocol).queryWith<Items<ResearchProject>, ResearchParams>(
    ({ organizationId, connectionId }) =>
      `${ENV}/research/projects?${new URLSearchParams({ organization_id: organizationId, connection_id: connectionId })}`
  );

  /** The hardware a Research project's services may run on. */
  readonly researchHardware = this.protocol(RestEndpointProtocol).queryWith<
    Items<ResearchHardware>,
    ResearchParams & { project: string }
  >(
    ({ organizationId, connectionId, project }) =>
      `${ENV}/research/projects/${enc(project)}/hardware?${new URLSearchParams({
        organization_id: organizationId,
        connection_id: connectionId,
      })}`
  );

  /** What runs where: the organization's deployments. */
  readonly deployments = this.protocol(RestEndpointProtocol).queryWith<DeploymentList, OrgParams>(
    ({ organizationId }) => `${ENV}/deployments?${org(organizationId)}`
  );

  /** Approve or decline a deploy to a protected environment. */
  decideDeployment(organizationId: string, id: string) {
    return this.rest.mutation<Deployment, { action: 'approve' | 'decline'; reason?: string }>(
      'POST',
      `${ENV}/deployments/${enc(id)}/decisions?${org(organizationId)}`
    );
  }

  /** The release's workloads and hosts, read from its cluster now. */
  readonly deploymentStatus = this.protocol(RestEndpointProtocol).queryWith<DeploymentStatus, OrgParams & { id: string }>(
    ({ organizationId, id }) => `${ENV}/deployments/${enc(id)}/status?${org(organizationId)}`
  );

  /** The end of each container's log of a deployed release, read from its cluster now. */
  readonly deploymentLogs = this.protocol(RestEndpointProtocol).queryWith<
    { containers: ContainerLog[] },
    OrgParams & { id: string }
  >(({ organizationId, id }) => `${ENV}/deployments/${enc(id)}/logs?${org(organizationId)}`);

  /** The namespace each project was given in each environment (ADR-0062). */
  readonly namespaceAssignments = this.protocol(RestEndpointProtocol).queryWith<
    { items: NamespaceAssignment[]; total: number },
    OrgParams
  >(({ organizationId }) => `${ENV}/namespace-assignments?${org(organizationId)}`);

  /** Give a project a namespace in an environment (an organization administrator). */
  saveNamespaceAssignment(organizationId: string) {
    return this.rest.mutation<
      NamespaceAssignment,
      { project_id: string; environment_id: string; namespace: string; build_namespace?: string | null }
    >('PUT', `${ENV}/namespace-assignments?${org(organizationId)}`);
  }

  /** How long images are kept: the organization's default. */
  readonly imageRetention = this.protocol(RestEndpointProtocol).queryWith<ImageRetention, OrgParams>(
    ({ organizationId }) => `${ENV}/image-retention?${org(organizationId)}`
  );

  saveImageRetention(organizationId: string) {
    return this.rest.mutation<ImageRetention, { keep_last?: number | null; keep_days?: number | null }>(
      'PUT',
      `${ENV}/image-retention?${org(organizationId)}`
    );
  }

  /** The registries the organization's environments use (`environment.manage`). */
  readonly orgRegistries = this.protocol(RestEndpointProtocol).queryWith<Items<OrgRegistry>, OrgParams>(
    ({ organizationId }) => `${ENV}/registries?${org(organizationId)}`
  );

  readonly registryRepositories = this.protocol(RestEndpointProtocol).queryWith<Items<RegistryRepository>, RegistryParams>(
    ({ organizationId, connectionId }) => `${ENV}/registries/${enc(connectionId)}/repositories?${org(organizationId)}`
  );

  /** A repository's versions; its name has slashes, so it is encoded whole. */
  readonly registryTags = this.protocol(RestEndpointProtocol).queryWith<
    Items<RegistryTag>,
    RegistryParams & { repository: string }
  >(
    ({ organizationId, connectionId, repository }) =>
      `${ENV}/registries/${enc(connectionId)}/repositories/${enc(repository)}/tags?${org(organizationId)}`
  );

  /** Delete one version from the registry: 202; 409 `IMAGE_RUNNING`. */
  deleteRegistryVersion(organizationId: string, connectionId: string, repository: string, digest: string) {
    return this.rest.mutation<{ run_id: string }, void>(
      'DELETE',
      `${ENV}/registries/${enc(connectionId)}/repositories/${enc(repository)}/versions/${enc(digest)}?${org(organizationId)}`
    );
  }

  /** What is in the registry that nothing in Studio accounts for, and why. */
  readonly registryOrphans = this.protocol(RestEndpointProtocol).queryWith<Items<RegistryOrphan>, RegistryParams>(
    ({ organizationId, connectionId }) => `${ENV}/registries/${enc(connectionId)}/orphans?${org(organizationId)}`
  );

  /* ── studio-connector: the places ── */

  /** Connections visible from the organization: its own, or inherited. */
  readonly connections = this.protocol(RestEndpointProtocol).queryWith<Items<Connection>, { tenantId: string }>(
    ({ tenantId }) => `/studio-connector/v1/connections?tenant=${enc(tenantId)}`
  );

  /** Verifies, then stores ("Test & connect"). The token never comes back out. */
  readonly createConnection = this.protocol(RestEndpointProtocol).mutation<
    ConnectionTest,
    { provider: string; label: string; base_url?: string; token: string; scope?: string; owner_tenant_id?: string }
  >('POST', '/studio-connector/v1/connections');

  /** Ask the place again; for a cluster, each right the bootstrap gives is checked too. */
  testConnection(id: string, tenantId: string) {
    return this.rest.mutation<ConnectionTest, void>(
      'POST',
      `/studio-connector/v1/connections/${enc(id)}/test?tenant=${enc(tenantId)}`
    );
  }

  /* ── account-management: who a user id is ── */

  readonly tenantUsers = this.protocol(RestEndpointProtocol).queryWith<UserPage, { tenantId: string; cursor?: string }>(
    ({ tenantId, cursor }) => {
      const qs = new URLSearchParams({ limit: '200' });
      if (cursor) qs.set('cursor', cursor);
      return `/account-management/v1/tenants/${enc(tenantId)}/users?${qs}`;
    }
  );
}
