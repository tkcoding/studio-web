/**
 * Where each person of an organization works — the prototype's `useOrgActivity`
 * (`people-org.tsx`), carried over (ADR-0069). Read-only and best-effort: each
 * source that cannot be read costs its own figures and is named in `missing`,
 * rather than showing a zero.
 *
 * The projects are the organization's workspaces' children (account
 * management), where the prototype read the portfolio rollups — the rollups
 * also carried a project's kind for its mark, which this screen does not draw.
 */

import { useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  AccountsApiService,
  INSIGHT_DAYS,
  PROJECT_CONFIG_TYPE,
  PeopleApiService,
  addDesktops,
  addEvents,
  addInsight,
  addOpenPulls,
  configRepos,
  directoryOf,
  insightFigures,
  insightStatements,
  repoProjects,
  type ActivityEvent,
  type ActivityIndex,
  type DesktopSession,
  type Directory,
  type InsightFigure,
  type MemberIdentities,
  type OpenPullRequest,
  type OrgProject,
  type PersonRow,
  type PresenceEntry,
} from '@constructor-studio/mfe-shared';

/** How far back the Activity feed counts. */
export const FEED_DAYS = 90;
export { INSIGHT_DAYS };

/** What Insight answered, and why when it did not. */
export type InsightState =
  | { state: 'loading' }
  | { state: 'ok'; figures: InsightFigure[]; truncated: boolean }
  | { state: 'no_handles' }
  | { state: 'failed'; detail: string };

/** A source that could not be read, as a message key and its count. */
export interface Missing {
  key: 'missing_workspaces' | 'missing_identities' | 'missing_pulls' | 'missing_feeds' | 'missing_presence';
  count: number;
}

export interface OrgActivity {
  /** Null until the projects were read; [] when they could not be. */
  projects: OrgProject[] | null;
  loading: boolean;
  identities: Map<string, MemberIdentities>;
  /** Whether identities could be read at all (`people.view`). */
  identitiesReadable: boolean;
  dir: Directory;
  index: ActivityIndex;
  feeds: { projectId: string; events: ActivityEvent[] }[];
  pulls: { projectId: string; items: OpenPullRequest[] }[];
  presence: PresenceEntry[];
  desktops: DesktopSession[];
  insight: InsightState;
  missing: Missing[];
}

const EMPTY_DIR: Directory = { byLogin: new Map(), bySubject: new Map() };

export function blankActivity(): OrgActivity {
  return {
    projects: null,
    loading: true,
    identities: new Map(),
    identitiesReadable: true,
    dir: EMPTY_DIR,
    index: new Map(),
    feeds: [],
    pulls: [],
    presence: [],
    desktops: [],
    insight: { state: 'loading' },
    missing: [],
  };
}

/** Run `work` over `items`, at most `limit` at once. */
async function pool<T, R>(items: readonly T[], limit: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The organization's projects, by workspace. */
async function orgProjects(orgId: string, missing: Missing[]): Promise<OrgProject[]> {
  const accounts = apiRegistry.getService(AccountsApiService);
  const workspaces = (await accounts.getWorkspaces({ organizationId: orgId }).fetch({ staleTime: 0 })).items ?? [];
  let unread = 0;
  const per = await pool(workspaces, 4, (w) =>
    accounts
      .getProjects({ parentId: w.id })
      .fetch({ staleTime: 0 })
      .then(
        (page) => (page.items ?? []).map((p) => ({ p, w })),
        () => {
          unread++;
          return [];
        }
      )
  );
  if (unread) missing.push({ key: 'missing_workspaces', count: unread });
  return per.flat().map(({ p, w }) => ({ id: p.id, name: p.name, workspaceId: w.id, workspaceName: w.name, kind: null }));
}

/** Everything the People page needs to place people on projects. */
export function useOrgActivity(orgId: string | null, people: readonly PersonRow[] | null): OrgActivity {
  const [state, setState] = useState<OrgActivity>(blankActivity);
  const ids = useMemo(() => (people ?? []).map((p) => p.id).join(','), [people]);

  useEffect(() => {
    if (!orgId || people === null) return;
    let live = true;
    const api = apiRegistry.getService(PeopleApiService);
    const accounts = apiRegistry.getService(AccountsApiService);
    const since = new Date(Date.now() - FEED_DAYS * 86_400_000).toISOString();
    const missing: Missing[] = [];
    void (async () => {
      const projects = await orgProjects(orgId, missing).catch(() => {
        missing.push({ key: 'missing_workspaces', count: 1 });
        return [] as OrgProject[];
      });
      if (!live) return;
      setState((s) => ({ ...s, projects, loading: true }));

      // Who each person is elsewhere: their sign-ins and git accounts.
      let readable = true;
      const idents = await pool(people, 6, (p) =>
        api
          .memberIdentities({ orgId, userId: p.id })
          .fetch({ staleTime: 0 })
          .catch(() => {
            readable = false;
            return null;
          })
      );
      const identities = new Map<string, MemberIdentities>();
      idents.forEach((i, n) => {
        if (i) identities.set(people[n].id, i);
      });
      if (!readable) missing.push({ key: 'missing_identities', count: 1 });
      const dir = directoryOf(
        people.map((p) => ({
          id: p.id,
          aliases: identities.get(p.id)?.aliases ?? [],
          subjects: (identities.get(p.id)?.logins ?? []).map((l) => l.subject),
        }))
      );

      // Per project: its repositories, open pull requests, feed and desktops.
      const per = await pool(projects, 4, async (p) => {
        const [config, pulls, feed, desk] = await Promise.all([
          accounts
            .getTenantMetadata<Parameters<typeof configRepos>[0]>({ tenantId: p.id, metadataType: PROJECT_CONFIG_TYPE })
            .fetch({ staleTime: 0 })
            .then(
              (e) => e?.value ?? null,
              () => null
            ),
          api
            .openPullRequests({ projectId: p.id })
            .fetch({ staleTime: 0 })
            .then(
              (r) => r.items,
              () => null
            ),
          api
            .activityFeed({ projectId: p.id })
            .fetch({ staleTime: 0 })
            .then(
              (r) => r.items,
              () => null
            ),
          api.desktopSessions(p.id).catch(() => null),
        ]);
        return { p, config, pulls, feed, desk };
      });
      const index: ActivityIndex = new Map();
      const feeds: OrgActivity['feeds'] = [];
      const pullsAll: OrgActivity['pulls'] = [];
      const desktops: DesktopSession[] = [];
      let lostPulls = 0;
      let lostFeeds = 0;
      for (const { p, pulls, feed, desk } of per) {
        if (pulls) {
          addOpenPulls(index, dir, p.id, pulls);
          pullsAll.push({ projectId: p.id, items: pulls });
        } else lostPulls++;
        if (feed) {
          addEvents(index, dir, p.id, feed, since);
          feeds.push({ projectId: p.id, events: feed.filter((e) => !e.recorded || e.recorded >= since) });
        } else lostFeeds++;
        if (desk) {
          addDesktops(index, dir, p.id, desk);
          desktops.push(...desk);
        }
      }
      if (lostPulls) missing.push({ key: 'missing_pulls', count: lostPulls });
      if (lostFeeds) missing.push({ key: 'missing_feeds', count: lostFeeds });
      const repos = repoProjects(
        per.map(({ p, config, pulls }) => ({
          id: p.id,
          repos: [...configRepos(config), ...(pulls ?? []).map((pr) => pr.repo ?? '').filter(Boolean)],
        }))
      );

      const presence = await api.presenceOnline.fetch({ staleTime: 0 }).then(
        (r) => r.items ?? [],
        () => {
          missing.push({ key: 'missing_presence', count: 1 });
          return [] as PresenceEntry[];
        }
      );
      if (!live) return;
      setState({
        projects,
        loading: true,
        identities,
        identitiesReadable: readable,
        dir,
        index,
        feeds,
        pulls: pullsAll,
        presence,
        desktops,
        insight: { state: 'loading' },
        missing: [...missing],
      });

      // Insight last: the slowest, and only for people with a git account.
      const sql = insightStatements([...dir.byLogin.keys()]);
      let insight: InsightState;
      if (!sql) insight = { state: 'no_handles' };
      else {
        try {
          const [a, r] = await Promise.all([
            api.insightQuery.fetch({ sql: sql.authored }),
            api.insightQuery.fetch({ sql: sql.reviewed }),
          ]);
          const figures = insightFigures(a.rows, r.rows);
          addInsight(index, dir, figures, repos);
          insight = { state: 'ok', figures, truncated: a.truncated || r.truncated };
        } catch (e) {
          insight = { state: 'failed', detail: message(e) };
        }
      }
      if (!live) return;
      setState((s) => ({ ...s, index: new Map(index), insight, loading: false }));
    })();
    return () => {
      live = false;
    };
    // `ids` stands for `people`: a new array with the same people is the same load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, ids]);

  return state;
}
