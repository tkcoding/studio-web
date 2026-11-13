/**
 * What Admin reads and writes, ported from the prototype's client
 * (`00828880:studio-frontend-prototype/src/api.ts`, ADR-0069): organizations
 * and their mode conversions (`account-management`), members, invitations and
 * people (`studio-user`), the identity directory (`studio-identity`), teams
 * (`resource-group`), the access catalogue and the logo
 * (`studio-organizations`), secrets (`credstore`), connections
 * (`studio-connector`), the type catalogue (`studio-components-catalog`,
 * `types-registry`) and the Studio domain model (`studio-domain-model`). Each
 * route names its gear behind the gateway prefix.
 *
 * Reads the shared `AccountsApiService` already has (me, a tenant, children,
 * tenant metadata) are taken from there, not repeated here.
 */

import { BaseApiService, RestEndpointProtocol, RestPlugin, RestProtocol, type RestRequestContext } from '@gears-frontx/react';
import type {
  AliasConfirmReport,
  AliasWrite,
  CatalogType,
  Colleague,
  Connection,
  ConnectionTest,
  ConnectorIdentity,
  ConnectorProvider,
  Conversion,
  DomainConformance,
  DomainModelEdit,
  DomainModelHistory,
  DomainModelGraph,
  DomainObjectsGraph,
  DomainTypeCounts,
  DomainTypesResponse,
  EnvironmentUse,
  GtsEntityPage,
  Group,
  MemberDirectory,
  MemberIdentities,
  MembershipRole,
  MyMembership,
  NotificationBody,
  NotifyTarget,
  OnlineList,
  OrgInvitation,
  OrgMember,
  OrganizationLogo,
  PersonAlias,
  PersonLogin,
  PlatformIdentity,
  QueuedNotification,
  RemoteRepo,
  SentMessage,
  StoredConnection,
  StudioProfile,
  TypeCount,
} from './types';
import type { RoleDef } from '../model/access';
import type { LooseQuery, LooseResult } from '../model/views-model';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const e = encodeURIComponent;

/** studio-user's page ceiling. */
export const MAX_PAGE = 200;

/**
 * `If-Match: *` on a credstore rotate: the gear's explicit unconditional
 * overwrite. A plugin because the mutation descriptor takes no headers.
 */
export class UnconditionalSecretPutPlugin extends RestPlugin {
  onRequest(context: RestRequestContext): RestRequestContext {
    if (context.method !== 'PUT' || !context.url.includes('/credstore/v1/secrets/')) return context;
    return { ...context, headers: { ...context.headers, 'If-Match': '*' } };
  }
}

export interface MembershipBody {
  role: MembershipRole;
  status?: 'active' | 'suspended';
  source?: 'assignment' | 'manual';
  /** Replaces how the organization describes the person; absent leaves it. */
  directory?: MemberDirectory;
}

export class AdminApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    restProtocol.plugins.add(new UnconditionalSecretPutPlugin());
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── account-management ── */

  readonly createTenant = this.protocol(RestEndpointProtocol).mutation<
    { id: string; name: string },
    { name: string; parent_id: string; tenant_type: string }
  >('POST', '/account-management/v1/tenants');

  /** Rename: `name` is the only mutable field (RFC 7396 merge patch). */
  renameTenant(tenantId: string) {
    return this.rest.mutation<unknown, { name: string }>('PATCH', `/account-management/v1/tenants/${e(tenantId)}`);
  }

  deleteTenant(tenantId: string) {
    return this.rest.mutation<void, void>('DELETE', `/account-management/v1/tenants/${e(tenantId)}`);
  }

  requestConversion(tenantId: string) {
    return this.rest.mutation<Conversion, { target_mode: 'managed' | 'self_managed'; comment: string }>(
      'POST',
      `/account-management/v1/tenants/${e(tenantId)}/conversions`
    );
  }

  readonly inboundConversions = this.protocol(RestEndpointProtocol).queryWith<
    { items?: Conversion[] },
    { parentId: string }
  >(({ parentId }) => `/account-management/v1/tenants/${e(parentId)}/child-conversions`);

  decideConversion(parentId: string, requestId: string) {
    return this.rest.mutation<Conversion, { status: 'approved' | 'rejected' }>(
      'PATCH',
      `/account-management/v1/tenants/${e(parentId)}/child-conversions/${e(requestId)}`
    );
  }

  /* ── studio-user ── */

  readonly membersPage = this.protocol(RestEndpointProtocol).queryWith<
    { items?: OrgMember[]; total?: number },
    { orgId: string; offset: number }
  >(
    ({ orgId, offset }) =>
      `/studio-user/v1/organizations/${e(orgId)}/members?${q({ offset: String(offset), limit: String(MAX_PAGE) })}`
  );

  /** An organization's members, every page (`people.view`: an owner or a platform admin). */
  async orgMembers(orgId: string): Promise<OrgMember[]> {
    const items: OrgMember[] = [];
    for (let offset = 0; ; offset += MAX_PAGE) {
      const body = await this.membersPage({ orgId, offset }).fetch({ staleTime: 0 });
      const page = body.items ?? [];
      items.push(...page);
      const total = typeof body.total === 'number' ? body.total : items.length;
      if (page.length === 0 || items.length >= total) return items;
    }
  }

  readonly colleaguesPage = this.protocol(RestEndpointProtocol).queryWith<
    { items?: Colleague[]; total?: number },
    { offset: number }
  >(({ offset }) => `/studio-user/v1/me/colleagues?${q({ offset: String(offset), limit: String(MAX_PAGE) })}`);

  /** Everybody the caller shares an organization with, every page. */
  async myColleagues(): Promise<Colleague[]> {
    const items: Colleague[] = [];
    for (let offset = 0; ; offset += MAX_PAGE) {
      const body = await this.colleaguesPage({ offset }).fetch({ staleTime: 0 });
      const page = body.items ?? [];
      items.push(...page);
      const total = typeof body.total === 'number' ? body.total : items.length;
      if (page.length === 0 || items.length >= total) return items;
    }
  }

  readonly myMemberships = this.protocol(RestEndpointProtocol).query<{ items: MyMembership[] }>(
    '/studio-user/v1/me/memberships'
  );

  readonly myProfile = this.protocol(RestEndpointProtocol).query<StudioProfile>('/studio-user/v1/me');

  /* ── studio-user: the caller's own person (Profile) ── */

  /** Change what the caller's person is called. A blank field is left as is. */
  readonly updateMyProfile = this.protocol(RestEndpointProtocol).mutation<StudioProfile, { display_name?: string }>(
    'POST',
    '/studio-user/v1/me'
  );

  /** Store the caller's photo (PNG, JPEG, WebP or GIF, at most 1 MiB, base64). */
  readonly uploadMyAvatar = this.protocol(RestEndpointProtocol).mutation<
    StudioProfile,
    { content_type: string; data: string }
  >('PUT', '/studio-user/v1/me/avatar');

  /** Remove the caller's stored photo. */
  readonly deleteMyAvatar = this.protocol(RestEndpointProtocol).mutation<StudioProfile, void>(
    'DELETE',
    '/studio-user/v1/me/avatar'
  );

  /** The sign-ins that resolve to the caller's person. */
  readonly myLogins = this.protocol(RestEndpointProtocol).query<{ items: PersonLogin[] }>('/studio-user/v1/me/logins');

  /** The outside accounts attributed to the caller's person. */
  readonly myAliases = this.protocol(RestEndpointProtocol).query<{ aliases: PersonAlias[] }>(
    '/studio-user/v1/me/aliases'
  );

  /** Say an account is the caller's. A claim attributes nothing until proved. */
  readonly claimMyAlias = this.protocol(RestEndpointProtocol).mutation<
    AliasWrite,
    { kind: string; external_id: string }
  >('POST', '/studio-user/v1/me/aliases');

  /** Take an account off the caller's person. */
  readonly revokeMyAlias = this.protocol(RestEndpointProtocol).mutation<
    AliasWrite,
    { kind: string; external_id: string }
  >('POST', '/studio-user/v1/me/aliases/revoke');

  /** Record every account the caller's sign-ins and personal connections already proved. */
  readonly confirmMyAliases = this.protocol(RestEndpointProtocol).mutation<AliasConfirmReport, void>(
    'POST',
    '/studio-user/v1/me/aliases/confirm'
  );

  readonly memberIdentities = this.protocol(RestEndpointProtocol).queryWith<
    MemberIdentities,
    { orgId: string; userId: string }
  >(({ orgId, userId }) => `/studio-user/v1/organizations/${e(orgId)}/members/${e(userId)}/identities`);

  /** Add somebody, change their role or description, suspend or resume them — one write. */
  putMembership(userId: string, orgId: string) {
    return this.rest.mutation<OrgMember, MembershipBody>(
      'PUT',
      `/studio-user/v1/users/${e(userId)}/memberships/${e(orgId)}`
    );
  }

  removeMembership(userId: string, orgId: string) {
    return this.rest.mutation<void, void>('DELETE', `/studio-user/v1/users/${e(userId)}/memberships/${e(orgId)}`);
  }

  /** The canonical Studio person behind a sign-in, created on first sight (platform admin). */
  readonly resolvePerson = this.protocol(RestEndpointProtocol).mutation<
    { user_id: string },
    { provider: 'keycloak'; subject: string; display_name?: string; email?: string }
  >('POST', '/studio-user/v1/resolve');

  readonly invitations = this.protocol(RestEndpointProtocol).queryWith<{ items: OrgInvitation[] }, { orgId: string }>(
    ({ orgId }) => `/studio-user/v1/organizations/${e(orgId)}/invitations`
  );

  invite(orgId: string) {
    return this.rest.mutation<{ invitation: OrgInvitation }, { email: string; role: 'member' | 'admin' }>(
      'POST',
      `/studio-user/v1/organizations/${e(orgId)}/invitations`
    );
  }

  revokeInvitation(orgId: string, invitationId: string) {
    return this.rest.mutation<void, void>(
      'DELETE',
      `/studio-user/v1/organizations/${e(orgId)}/invitations/${e(invitationId)}`
    );
  }

  /* ── studio-identity (platform administrator only) ── */

  readonly platformIdentities = this.protocol(RestEndpointProtocol).query<{ items: PlatformIdentity[] }>(
    '/studio-identity/v1/users'
  );

  assignIdentity(identityId: string) {
    return this.rest.mutation<void, { tenant_id: string; role: MembershipRole }>(
      'POST',
      `/studio-identity/v1/users/${e(identityId)}/assignment`
    );
  }

  /* ── resource-group ── */

  readonly groups = this.protocol(RestEndpointProtocol).query<{ items?: Group[] }>('/resource-group/v1/groups');

  /* ── studio-organizations ── */

  /** The privilege catalogue and the seeded role ladder, from the side that evaluates them. */
  readonly accessCatalogue = this.protocol(RestEndpointProtocol).query<{
    privileges: string[];
    default_roles: RoleDef[];
  }>('/studio-organizations/v1/access-catalogue');

  /** An organization's logo; 404 when it has none. */
  readonly logo = this.protocol(RestEndpointProtocol).queryWith<OrganizationLogo, { orgId: string }>(
    ({ orgId }) => `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`
  );

  setLogo(orgId: string) {
    return this.rest.mutation<OrganizationLogo, { content_type: string; data: string }>(
      'PUT',
      `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`
    );
  }

  deleteLogo(orgId: string) {
    return this.rest.mutation<void, void>('DELETE', `/studio-organizations/v1/logo?${q({ organization_id: orgId })}`);
  }

  /* ── credstore ── */

  readonly createSecret = this.protocol(RestEndpointProtocol).mutation<
    unknown,
    { reference: string; value: string; sharing: 'tenant'; type?: string }
  >('POST', '/credstore/v1/secrets');

  /** Unconditional overwrite (`If-Match: *`, see the plugin above). */
  rotateSecret(reference: string) {
    return this.rest.mutation<unknown, { value: string; sharing: 'tenant'; type?: string }>(
      'PUT',
      `/credstore/v1/secrets/${e(reference)}`
    );
  }

  readonly secret = this.protocol(RestEndpointProtocol).queryWith<unknown, { reference: string }>(
    ({ reference }) => `/credstore/v1/secrets/${e(reference)}`
  );

  deleteSecret(reference: string) {
    return this.rest.mutation<unknown, void>('DELETE', `/credstore/v1/secrets/${e(reference)}`);
  }

  /* ── studio-connector ── */

  readonly connections = this.protocol(RestEndpointProtocol).queryWith<{ items: Connection[] }, { tenant: string }>(
    ({ tenant }) => `/studio-connector/v1/connections?${q({ tenant })}`
  );

  /* ── studio-connector: Integrations ── */

  readonly connectorProviders = this.protocol(RestEndpointProtocol).query<{ items: ConnectorProvider[] }>(
    '/studio-connector/v1/providers'
  );

  /**
   * Connections visible from `tenant`: its own, or inherited from an ancestor. With
   * `withAncestors`, its own together with every one held above it up to its organization,
   * each marked `inherited` (#1043).
   */
  readonly storedConnections = this.protocol(RestEndpointProtocol).queryWith<
    { items: StoredConnection[] },
    { tenant: string; withAncestors?: boolean }
  >(({ tenant, withAncestors }) =>
    withAncestors
      ? `/studio-connector/v1/connections?${q({ tenant, with_ancestors: 'true' })}`
      : `/studio-connector/v1/connections?${q({ tenant })}`
  );

  /** Verify a credential without storing it ("Test connection"). */
  readonly probeConnection = this.protocol(RestEndpointProtocol).mutation<
    ConnectorIdentity,
    { provider: string; base_url?: string; token: string }
  >('POST', '/studio-connector/v1/probe');

  /** Verifies, then stores ("Test & save"). The token never comes back out. */
  readonly createConnection = this.protocol(RestEndpointProtocol).mutation<
    ConnectionTest,
    { provider: string; label: string; base_url?: string; token: string; scope: string; owner_tenant_id: string }
  >('POST', '/studio-connector/v1/connections');

  /** Relabel, move to another installation, or rotate the credential; the id survives. */
  patchConnection(id: string, tenant: string) {
    return this.rest.mutation<ConnectionTest, { label?: string; base_url?: string; token?: string }>(
      'PATCH',
      `/studio-connector/v1/connections/${e(id)}?${q({ tenant })}`
    );
  }

  testConnection(id: string, tenant: string) {
    return this.rest.mutation<ConnectionTest, void>(
      'POST',
      `/studio-connector/v1/connections/${e(id)}/test?${q({ tenant })}`
    );
  }

  /** Removes the row from the connection's owning tenant. */
  deleteConnection(id: string, tenant: string) {
    return this.rest.mutation<void, void>('DELETE', `/studio-connector/v1/connections/${e(id)}?${q({ tenant })}`);
  }

  readonly connectionRepositories = this.protocol(RestEndpointProtocol).queryWith<
    { items: RemoteRepo[] },
    { id: string; tenant: string; search: string }
  >(({ id, tenant, search }) => {
    const params: Record<string, string> = { tenant };
    if (search.trim()) params.search = search.trim();
    return `/studio-connector/v1/connections/${e(id)}/repositories?${q(params)}`;
  });

  /** First half of a connection made by signing in: where to send the person. */
  readonly startSignIn = this.protocol(RestEndpointProtocol).mutation<
    { authorize_url: string },
    { provider: string; label: string; scope: string; owner_tenant_id: string; redirect_uri: string }
  >('POST', '/studio-connector/v1/oauth/start');

  /* ── studio-environments, studio-components-catalog: what Integrations reads beside ── */

  /** The organization's environments, for the clusters' and registries' Used by. */
  readonly environments = this.protocol(RestEndpointProtocol).queryWith<{ items: EnvironmentUse[] }, { orgId: string }>(
    ({ orgId }) => `/studio-environments/v1/environments?${q({ organization_id: orgId })}`
  );

  /** Read a tenant's repositories into its own catalogue now. */
  syncProjectCatalogue(projectId: string) {
    return this.rest.mutation<unknown, void>(
      'POST',
      `/studio-components-catalog/v1/project-catalogue/sync?${q({ project_id: projectId })}`
    );
  }

  /* ── studio-components-catalog, types-registry ── */

  /** Every node type the graph holds, and which of them this organization treats as components. */
  readonly catalogTypes = this.protocol(RestEndpointProtocol).queryWith<{ types?: CatalogType[] }, { orgId: string }>(
    ({ orgId }) => `/studio-components-catalog/v1/types?${q({ organization_id: orgId })}`
  );

  readonly typeCounts = this.protocol(RestEndpointProtocol).queryWith<{ counts?: TypeCount[] }, { orgId: string }>(
    ({ orgId }) => `/studio-components-catalog/v1/types/counts?${q({ organization_id: orgId })}`
  );

  setTypeComponent(orgId: string, typeId: string) {
    return this.rest.mutation<CatalogType, { component: boolean }>(
      'PUT',
      `/studio-components-catalog/v1/types/${e(typeId)}/component?${q({ organization_id: orgId })}`
    );
  }

  readonly gtsTypeTitles = this.protocol(RestEndpointProtocol).query<GtsEntityPage>('/types-registry/v1/entities');

  /* ── System: the platform's raw state (the prototype's `SystemView`) ── */

  /** The running gears (`gear-orchestrator`), raw. */
  readonly gears = this.protocol(RestEndpointProtocol).query<unknown>('/gear-orchestrator/v1/gears');

  /** The outbound API gateway's upstreams (`oagw`), raw. */
  readonly oagwUpstreams = this.protocol(RestEndpointProtocol).query<unknown>('/oagw/v1/upstreams');

  /** Every registered GTS entity, raw (the same read as `gtsTypeTitles`, kept whole). */
  readonly gtsEntities = this.protocol(RestEndpointProtocol).query<unknown>('/types-registry/v1/entities');

  /* ── studio-presence ── */

  /** Who is in Studio right now, and where. Not paged: it is about now. */
  readonly presenceOnline = this.protocol(RestEndpointProtocol).query<OnlineList>('/studio-presence/v1/online');

  /** Leave a note for somebody in Studio now; `delivered: false` means they are not, and nothing was queued. */
  readonly presenceSend = this.protocol(RestEndpointProtocol).mutation<
    { delivered: boolean; waiting: number },
    { to_user_id: string; text: string; from_display_name?: string }
  >('POST', '/studio-presence/v1/messages');

  /* ── studio-connector / studio-notify: a test notification ── */

  readonly notifyTargets = this.protocol(RestEndpointProtocol).queryWith<
    { items: NotifyTarget[] },
    { id: string; tenant: string }
  >(({ id, tenant }) => `/studio-connector/v1/connections/${e(id)}/targets?${q({ tenant })}`);

  /** Post now and wait for the platform's answer: delivered once, never retried. */
  sendConnectorMessage(id: string, tenant: string) {
    return this.rest.mutation<
      SentMessage,
      { target?: string; title?: string; text: string; link?: string; topic?: string }
    >('POST', `/studio-connector/v1/connections/${e(id)}/messages?${q({ tenant })}`);
  }

  /** Queue a notification: a `notify.deliver` run, retried and dead-lettered rather than dropped. */
  readonly queueNotification = this.protocol(RestEndpointProtocol).mutation<QueuedNotification, NotificationBody>(
    'POST',
    '/studio-notify/v1/messages'
  );

  /*
   * ── studio-domain-model: the Studio domain model (ADR-0066) ──
   * Per organization: the prototype named the organization on screen
   * (`?organization_id=`, its `orgScoped`), since a platform administrator's
   * home tenant is the platform root, whose model is not the organization's.
   */

  /**
   * The organization's model, and whether the caller may change it. Admin asks for what kits left
   * dormant too (`include=dormant`, ADR-0070 §4): only this screen shows them, marked `left_by`.
   */
  readonly domainTypes = this.protocol(RestEndpointProtocol).queryWith<DomainTypesResponse, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/types?${q({ organization_id: orgId, include: 'dormant' })}`
  );

  /** How many objects of each type the organization holds. */
  readonly domainTypeCounts = this.protocol(RestEndpointProtocol).queryWith<DomainTypeCounts, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/type-counts?${q({ organization_id: orgId })}`
  );

  readonly domainConformance = this.rest.queryWith<DomainConformance, { orgId: string; typeId: string }>(
    ({ orgId, typeId }) => `/studio-domain-model/v1/types/${e(typeId)}/conformance?${q({ organization_id: orgId })}`
  );

  readonly domainHistory = this.rest.queryWith<DomainModelHistory, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/model/versions?${q({ organization_id: orgId })}`
  );

  readonly domainModelGraph = this.rest.queryWith<DomainModelGraph, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/model/graph?${q({ organization_id: orgId })}`
  );

  readonly domainObjectsGraph = this.rest.queryWith<DomainObjectsGraph, { orgId: string }>(
    ({ orgId }) => `/studio-domain-model/v1/objects/graph?${q({ organization_id: orgId })}`
  );

  importDomainModel(orgId: string) {
    return this.rest.mutation<{ entities: number; buckets: number; node_types: number; edge_types: number }, { ontology: unknown }>(
      'POST', `/studio-domain-model/v1/model/import?${q({ organization_id: orgId })}`
    );
  }

  syncDomainModel(orgId: string) {
    return this.rest.mutation<unknown, void>('POST', `/studio-domain-model/v1/model/sync?${q({ organization_id: orgId })}`);
  }

  revertDomainModel(orgId: string) {
    return this.rest.mutation<{ version: number; undone: number[] }, { to: number }>(
      'POST', `/studio-domain-model/v1/model/revert?${q({ organization_id: orgId })}`
    );
  }

  /** Add a type to the model: it starts with no fields of its own. */
  createDomainType(orgId: string) {
    return this.rest.mutation<
      DomainModelEdit,
      { id: string; name?: string; description?: string; bucket?: string; extends?: string }
    >('POST', `/studio-domain-model/v1/types?${q({ organization_id: orgId })}`);
  }

  /** A level's model tab: a shows relation to another domain type. */
  addDomainTab(orgId: string, type: string) {
    return this.rest.mutation<DomainModelEdit, { name: string; label?: string; target: string }>(
      'POST', `/studio-domain-model/v1/types/${e(type)}/tabs?${q({ organization_id: orgId })}`
    );
  }

  /** Add a field to a type; objects written from now on may carry it. */
  addDomainField(orgId: string, type: string) {
    return this.rest.mutation<DomainModelEdit, { name: string; type: string; description?: string; required?: boolean }>(
      'POST',
      `/studio-domain-model/v1/types/${e(type)}/fields?${q({ organization_id: orgId })}`
    );
  }

  /** Rename, retype, require or describe a field the type itself declares. */
  editDomainField(orgId: string, type: string, name: string) {
    return this.rest.mutation<
      DomainModelEdit,
      { rename_to?: string; type?: string; required?: boolean; description?: string }
    >('PATCH', `/studio-domain-model/v1/types/${e(type)}/fields/${e(name)}?${q({ organization_id: orgId })}`);
  }

  /**
   * Read objects of one type: filtered, ordered, projected, related, paged by
   * cursor (ADR-0066). What a saved view runs; a POST, so a mutation
   * descriptor, but a read: it answers 200 and writes nothing.
   */
  queryDomain(orgId: string) {
    return this.rest.mutation<LooseResult, LooseQuery>(
      'POST', `/studio-domain-model/v1/query?${q({ organization_id: orgId })}`
    );
  }

  /** Change domain objects in one batch, each checked against the model and the caller's rights. */
  mutateDomain(orgId: string) {
    return this.rest.mutation<{ results: unknown[] }, { validate?: 'strict' | 'warn' | 'off'; operations: Record<string, unknown>[] }>(
      'POST', `/studio-domain-model/v1/mutate?${q({ organization_id: orgId })}`
    );
  }

  /** Drop a field the type itself declares. Stored values stay in the objects. */
  removeDomainField(orgId: string, type: string, name: string) {
    return this.rest.mutation<unknown, void>(
      'DELETE',
      `/studio-domain-model/v1/types/${e(type)}/fields/${e(name)}?${q({ organization_id: orgId })}`
    );
  }
}
