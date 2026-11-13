/**
 * What the organization's People and a project's Team read and write, beyond
 * account management (the access config and a project's configuration are
 * tenant metadata, read through `AccountsApiService`). Each route names its
 * gear behind the gateway prefix. Registered by every MFE that shows people.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { RoleDef } from './access';
import type {
  ActivityEvent,
  Colleague,
  DesktopSession,
  InsightQueryResult,
  MemberIdentities,
  OpenPullRequest,
  OrgInvitation,
  OrgMember,
  PresenceEntry,
} from './types';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
const e = encodeURIComponent;

/** studio-user's page ceiling. */
export const PEOPLE_PAGE = 200;

export class PeopleApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: '/cf' }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /* ── studio-user ── */

  readonly membersPage = this.protocol(RestEndpointProtocol).queryWith<
    { items?: OrgMember[]; total?: number },
    { orgId: string; offset: number }
  >(
    ({ orgId, offset }) =>
      `/studio-user/v1/organizations/${e(orgId)}/members?${q({ offset: String(offset), limit: String(PEOPLE_PAGE) })}`
  );

  /** An organization's members, every page (`people.view`). */
  async orgMembers(orgId: string): Promise<OrgMember[]> {
    const items: OrgMember[] = [];
    for (let offset = 0; ; offset += PEOPLE_PAGE) {
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
  >(({ offset }) => `/studio-user/v1/me/colleagues?${q({ offset: String(offset), limit: String(PEOPLE_PAGE) })}`);

  /** Everybody the caller shares an organization with, every page. */
  async myColleagues(): Promise<Colleague[]> {
    const items: Colleague[] = [];
    for (let offset = 0; ; offset += PEOPLE_PAGE) {
      const body = await this.colleaguesPage({ offset }).fetch({ staleTime: 0 });
      const page = body.items ?? [];
      items.push(...page);
      const total = typeof body.total === 'number' ? body.total : items.length;
      if (page.length === 0 || items.length >= total) return items;
    }
  }

  readonly memberIdentities = this.protocol(RestEndpointProtocol).queryWith<
    MemberIdentities,
    { orgId: string; userId: string }
  >(({ orgId, userId }) => `/studio-user/v1/organizations/${e(orgId)}/members/${e(userId)}/identities`);

  /** A Studio invitation the person accepts when they sign in with the address. */
  invite(orgId: string) {
    return this.rest.mutation<{ invitation: OrgInvitation }, { email: string; role: 'member' | 'admin' }>(
      'POST',
      `/studio-user/v1/organizations/${e(orgId)}/invitations`
    );
  }

  /* ── studio-organizations ── */

  /** The seeded role ladder, from the side that evaluates it. */
  readonly accessCatalogue = this.protocol(RestEndpointProtocol).query<{
    privileges: string[];
    default_roles: RoleDef[];
  }>('/studio-organizations/v1/access-catalogue');

  /* ── where somebody works ── */

  readonly openPullRequests = this.protocol(RestEndpointProtocol).queryWith<
    { items: OpenPullRequest[]; total?: number },
    { projectId: string }
  >(({ projectId }) => `/studio-artifact-ingest/v1/open-pull-requests?${q({ project_id: projectId })}`);

  readonly activityFeed = this.protocol(RestEndpointProtocol).queryWith<
    { items: ActivityEvent[]; total?: number },
    { projectId: string }
  >(({ projectId }) => `/studio-artifact-ingest/v1/activity?${q({ project_id: projectId })}`);

  readonly desktopSessionsPage = this.protocol(RestEndpointProtocol).queryWith<
    { items?: DesktopSession[]; total?: number },
    { projectId: string; offset: number }
  >(
    ({ projectId, offset }) =>
      `/studio-session/v1/desktop-sessions?${q({ project_id: projectId, offset: String(offset), limit: String(PEOPLE_PAGE) })}`
  );

  /** The desktops open on a project, every page. */
  async desktopSessions(projectId: string): Promise<DesktopSession[]> {
    const items: DesktopSession[] = [];
    for (let offset = 0; ; offset += PEOPLE_PAGE) {
      const body = await this.desktopSessionsPage({ projectId, offset }).fetch({ staleTime: 0 });
      const page = body.items ?? [];
      items.push(...page);
      const total = typeof body.total === 'number' ? body.total : items.length;
      if (page.length === 0 || items.length >= total) return items;
    }
  }

  readonly presenceOnline = this.protocol(RestEndpointProtocol).query<{ items: PresenceEntry[] }>(
    '/studio-presence/v1/online'
  );

  readonly insightQuery = this.protocol(RestEndpointProtocol).mutation<InsightQueryResult, { sql: string }>(
    'POST',
    '/studio-insight/v1/query'
  );
}
