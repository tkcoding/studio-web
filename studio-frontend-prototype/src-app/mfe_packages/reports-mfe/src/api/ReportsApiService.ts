/**
 * What Organization › Reports reads and writes (ported from the prototype's
 * client, ADR-0069 §5): the `studio-reports` gear — every report, its source
 * in this organization, its hourly schedule, a refresh, the roadmap summary
 * and the plan — plus the one `studio-tasks` run a refresh is waited on
 * through, and the organization's members (`studio-user`) that name the plan's
 * people.
 *
 * Every reports route names the organization on screen (`organization_id`): a
 * caller's home tenant need not be it — a platform administrator's is the
 * platform root, where the organization's connection does not exist.
 *
 * The two file downloads (the workbook and `gears.yaml`) are `download.ts`'s.
 */

import { BaseApiService, RestEndpointProtocol, RestPlugin, RestProtocol, type RestRequestContext } from '@gears-frontx/react';
import type { MirrorSummary, Plan, PlanPeople, PlanSection } from '../model/plan-model';
import { sectionBody } from '../model/plan-model';
import type { Report, ReportSchedule, ReportSource, ReportSourceInput } from '../model/reports-model';
import type { RoadmapReport } from '../model/roadmap-report';

export const REPORTS_PATH = '/studio-reports/v1/reports';

/** `?organization_id=…` (or `&…`), the organization every reports call names. */
export function orgQuery(organizationId: string, sep: '?' | '&' = '?'): string {
  return `${sep}organization_id=${encodeURIComponent(organizationId)}`;
}

/** One report's route: `/studio-reports/v1/reports/{id}{rest}?organization_id=…`. */
export function reportPath(reportId: string, rest: string, organizationId: string): string {
  return `${REPORTS_PATH}/${encodeURIComponent(reportId)}${rest}${orgQuery(organizationId)}`;
}

/** A report's refresh starts background work: the POST that queues it. */
const startsRefresh = (url: string) => /\/studio-reports\/v1\/reports\/[^/]+\/sync\?/.test(url);

/**
 * `Idempotency-Key` on the refresh POST (docs/api-conventions.md D1): a lost
 * answer retried answers the run the first one started instead of a second.
 * The body is empty, so every call is its own intent and its own key.
 */
class RefreshIdempotencyPlugin extends RestPlugin {
  onRequest(context: RestRequestContext): RestRequestContext {
    if (context.method !== 'POST' || !startsRefresh(context.url) || context.headers['Idempotency-Key'] !== undefined) {
      return context;
    }
    return { ...context, headers: { ...context.headers, 'Idempotency-Key': crypto.randomUUID() } };
  }
}

export interface ReportParams {
  organizationId: string;
  reportId: string;
}

/** A `studio-tasks` run, as much of it as waiting on one needs. */
export interface TaskRun {
  id: string;
  /** `queued` | `running` | `succeeded` | `failed` | `cancelled`. */
  state: string;
  summary?: string | null;
  last_error?: string | null;
}

/** An organization's member, as much as naming one needs. */
export interface OrgMember {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
}

export interface MembersPage {
  items: OrgMember[];
  total?: number;
}

/** The page size the members list is read in. */
export const MEMBERS_PAGE = 200;

export class ReportsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    // The gateway prefix: every path below names its gear.
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
    restProtocol.plugins.add(new RefreshIdempotencyPlugin());
  }

  private get rest() {
    return this.protocol(RestEndpointProtocol);
  }

  /** Every report this deployment draws, with this organization's source. */
  readonly reports = this.protocol(RestEndpointProtocol).queryWith<{ items: Report[]; total: number }, { organizationId: string }>(
    ({ organizationId }) => `${REPORTS_PATH}${orgQuery(organizationId)}`
  );

  /** The roadmap report's data as typed JSON: one row per planned gear. */
  readonly summary = this.protocol(RestEndpointProtocol).queryWith<RoadmapReport, ReportParams>(({ organizationId, reportId }) =>
    reportPath(reportId, '/summary', organizationId)
  );

  /** Whether the report refreshes on its own. */
  readonly schedule = this.protocol(RestEndpointProtocol).queryWith<ReportSchedule, ReportParams>(({ organizationId, reportId }) =>
    reportPath(reportId, '/schedule', organizationId)
  );

  /** The report's plan in sections; revision 0 and empty when there is none yet. */
  readonly plan = this.protocol(RestEndpointProtocol).queryWith<Plan, ReportParams>(({ organizationId, reportId }) =>
    reportPath(reportId, '/plan', organizationId)
  );

  /** The plan's people matched to Studio's by confirmed GitHub account, and
   *  the organization's members the plan does not list. */
  readonly planPeople = this.protocol(RestEndpointProtocol).queryWith<PlanPeople, ReportParams>(({ organizationId, reportId }) =>
    reportPath(reportId, '/plan/people', organizationId)
  );

  /** One run. `tenant` is where it was queued: a report's runs live in its organization. */
  readonly taskRun = this.protocol(RestEndpointProtocol).queryWith<TaskRun, { runId: string; tenant: string }>(
    ({ runId, tenant }) => `/studio-tasks/v1/runs/${encodeURIComponent(runId)}?tenant=${encodeURIComponent(tenant)}`
  );

  /** One page of the organization's members (`people.view`). */
  readonly membersPage = this.protocol(RestEndpointProtocol).queryWith<
    MembersPage,
    { organizationId: string; offset: number }
  >(
    ({ organizationId, offset }) =>
      `/studio-user/v1/organizations/${encodeURIComponent(organizationId)}/members?offset=${offset}&limit=${MEMBERS_PAGE}`
  );

  /** Every member of the organization, page by page. */
  async members(organizationId: string): Promise<OrgMember[]> {
    const items: OrgMember[] = [];
    for (let offset = 0; ; offset += MEMBERS_PAGE) {
      const page = await this.membersPage({ organizationId, offset }).fetch({ staleTime: 0 });
      const got = page.items ?? [];
      items.push(...got);
      const total = typeof page.total === 'number' ? page.total : items.length;
      // An empty page also ends it: a server that ignores the parameters must not spin forever.
      if (got.length === 0 || items.length >= total) return items;
    }
  }

  /** Set where the report's board and plan come from: a field left out keeps its value. */
  updateSource(p: ReportParams) {
    return this.rest.mutation<ReportSource, ReportSourceInput>('PUT', reportPath(p.reportId, '/source', p.organizationId));
  }

  /** Switch the report's own (hourly) refresh on or off. */
  updateSchedule(p: ReportParams) {
    return this.rest.mutation<ReportSchedule, { enabled: boolean }>('PUT', reportPath(p.reportId, '/schedule', p.organizationId));
  }

  /** Read the plan again and sync the board: a `reports.refresh` run. */
  sync(p: ReportParams) {
    return this.rest.mutation<{ run_id: string; status: string }, void>('POST', reportPath(p.reportId, '/sync', p.organizationId));
  }

  /** Save one section of the plan, made against the revision it was read at.
   *  A 409 means somebody saved since; a 400 says why the plan would not hold. */
  async updatePlan(p: ReportParams, section: PlanSection, plan: Plan): Promise<Plan> {
    return this.rest
      .mutation<Plan, Record<string, unknown>>('PUT', reportPath(p.reportId, `/plan/${section}`, p.organizationId))
      .fetch(sectionBody(section, plan));
  }

  /** Mirror the plan's units, teams, people and memberships into the Studio domain model now. */
  syncPlan(p: ReportParams) {
    return this.rest.mutation<MirrorSummary, void>('POST', reportPath(p.reportId, '/plan/sync', p.organizationId));
  }
}
