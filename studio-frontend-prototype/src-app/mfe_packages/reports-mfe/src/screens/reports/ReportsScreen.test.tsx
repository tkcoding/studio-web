import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../model/plan-model';
import type { Report, ReportSource } from '../../model/reports-model';
import type { RoadmapReport } from '../../model/roadmap-report';

const { service, org, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { what: string; arg: unknown }[],
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key}_${count === 1 ? 'one' : 'many'} ${count}`;
  return { useReportsTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { ReportsScreen } from './ReportsScreen';

const settle = (value: unknown) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
/** A read: `name(params).fetch()`. */
const answer = (what: string, value: unknown) => (params?: unknown) => {
  calls.push({ what, arg: params });
  return { fetch: () => settle(value) };
};
/** A write: `name(params).fetch(body)`. */
const write = (what: string, value: unknown) => () => ({
  fetch: (body: unknown) => {
    calls.push({ what, arg: body });
    return settle(value);
  },
});

const source = (patch: Partial<ReportSource> = {}): ReportSource => ({
  report: 'roadmap',
  connection_id: null,
  plan_file: 'acme/plans:gears.yaml@main',
  plan_uploaded: false,
  board: null,
  roots: [],
  consumers: {},
  snapshot: { from: 'acme/plans:gears.yaml@main', sha: 'abc', read_at: '2026-11-09T10:42:00Z', size: 10 },
  plan: { board: 'acme/48', people: 4, teams: 2, projects: 3 },
  last_refresh: null,
  ...patch,
});

const report = (patch: Partial<Report> = {}): Report => ({
  id: 'roadmap',
  title: 'Roadmap',
  description: 'What the board plans.',
  definition: 'back_roadmap',
  sheets: ['Summary', 'Gantt'],
  definition_error: null,
  source: source(),
  ...patch,
});

const roadmap: RoadmapReport = {
  items: [
    {
      name: 'cf-auth',
      title: 'CORE - cf-auth',
      number: 7,
      group: 'CORE',
      components: ['cf-auth'],
      closed: false,
      off_board: false,
      category: 'core',
      readiness: {
        stage: 'Beta',
        stage_at: 2,
        stage_of: 4,
        lifecycle: null,
        milestone: 'M1',
        due: '2026-12-01',
        committed: true,
        plan: 'On track',
        plan_lamp: 'good',
        plan_reasons: [],
        demand: [{ consumer: 'Acronis', priority: 1 }],
        progress: [],
        last_release: null,
        released_on: null,
        used_by: null,
        roadmap_item: null,
        grade: 'B',
        grade_fixes: [],
      },
      assignees: '@a',
      effort_md: 10,
      remaining_md: 4,
      roadmap_title: null,
    },
  ],
  total: 1,
  not_in_code: 0,
  not_on_board: 2,
  summary: {
    by_group: [
      { group: 'CORE', total: 1, done: 0, in_code: 1, axes: [], estimated: 1, effort_md: 10, remaining_md: 4 },
    ],
    by_stage: [{ label: 'Beta', count: 1 }],
    by_milestone: [{ milestone: 'M1', due: '2026-12-01', total: 1, committed: 1, at_risk: 0 }],
    by_consumer: [],
    by_plan: [{ label: 'On track', count: 1 }],
    overdue: ['M0'],
  },
};

const plan = (patch: Partial<Plan> = {}): Plan => ({
  revision: 2,
  from: 'studio',
  changed_at: null,
  changed_by: null,
  file: null,
  lanes: { order: [], labels: [] },
  units: [{ name: 'Northwind', color: null, teams: [] }],
  no_unit_color: null,
  people: [{ login: 'octo', alias: null, team: null, unit: null, power: 1, email: null }],
  projects: [],
  needs: [],
  ...patch,
});

function serve(over: Record<string, unknown> = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    reports: answer('reports', { items: [report()], total: 1 }),
    schedule: answer('schedule', { enabled: true, cron: null, next_run_at: null, last_run: null }),
    summary: answer('summary', roadmap),
    connections: answer('connections', {
      items: [
        { id: 'c1', provider: 'github', label: 'Acme GitHub', account: 'acme' },
        { id: 'c2', provider: 'slack', label: 'Chat', account: 'acme' },
      ],
    }),
    getWorkspaces: answer('workspaces', { items: [{ id: 'w1', name: 'Platform' }] }),
    updateSource: write('updateSource', source()),
    updateSchedule: write('updateSchedule', { enabled: false, cron: null, next_run_at: null, last_run: null }),
    sync: write('sync', { run_id: 'r1', status: 'queued' }),
    taskRun: answer('taskRun', { id: 'r1', state: 'succeeded', summary: 'read 4 people' }),
    plan: answer('plan', plan()),
    planPeople: answer('planPeople', { people: [], unplanned: [], members_without_github: 0, identities_available: false }),
    members: () => Promise.resolve([]),
    updatePlan: (_p: unknown, section: string) => {
      calls.push({ what: 'updatePlan', arg: section });
      return Promise.resolve(plan({ revision: 3 }));
    },
    syncPlan: write('syncPlan', { written: 3, unchanged: 1, retired: 0, skipped: [] }),
    ...over,
  });
}

const find = async (selector: string, root: ParentNode = document) =>
  waitFor(() => {
    const found = root.querySelector(selector);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

describe('ReportsScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    org.value = { id: 'o1', name: 'Acme' };
    serve();
  });

  it('asks for an organization when none is in scope', () => {
    org.value = null;
    render(<ReportsScreen />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it("lists the organization's reports with their state, schedule and the roadmap's tables", async () => {
    const { container } = render(<ReportsScreen />);
    const card = await find('[data-report="roadmap"]', container);
    expect(container.querySelector('[data-reports-count]')?.textContent).toBe('reports_one 1');
    expect(card.querySelector('[data-report-state="ready"]')?.textContent).toContain('2026-11-09 10:42');
    await waitFor(() => expect(card.textContent).toContain('hourly'));
    const row = await find('[data-roadmap-row="CORE - cf-auth"]', card);
    expect(row.textContent).toContain('Acronis P1');
    expect(card.querySelector('[data-roadmap-overdue]')?.textContent).toContain('M0');
    expect(card.querySelector('[data-kpi="kpi_not_on_board"]')?.textContent).toContain('2');
    // Every reports read names the organization on screen.
    expect(calls).toContainEqual({ what: 'reports', arg: { organizationId: 'o1' } });
    expect(calls).toContainEqual({ what: 'summary', arg: { organizationId: 'o1', reportId: 'roadmap' } });
  });

  it('offers to configure a report with no source, and draws nothing for it', async () => {
    serve({ reports: answer('reports', { items: [report({ source: source({ plan_file: null, snapshot: null, plan: null }) })], total: 1 }) });
    const { container } = render(<ReportsScreen />);
    const card = await find('[data-report="roadmap"]', container);
    expect(card.querySelector('[data-report-empty]')).not.toBeNull();
    expect(card.querySelector('[data-report-state]')).toBeNull();
    expect(card.querySelector('[data-roadmap]')).toBeNull();
    expect(container.textContent).toContain('not_configured_one 1');
  });

  it('says why a failed refresh needs attention', async () => {
    serve({
      reports: answer('reports', {
        items: [report({ source: source({ last_refresh: { at: '2026-11-09T10:00:00Z', sync_run: null, error: 'no access' } }) })],
        total: 1,
      }),
    });
    const { container } = render(<ReportsScreen />);
    const alert = await find('[data-report-attention]', container);
    expect(alert.textContent).toBe('The last refresh failed: no access');
    expect(container.textContent).toContain('attention_one 1');
  });

  it('refreshes: saves the source, queues the run and waits for it', async () => {
    const { container } = render(<ReportsScreen />);
    const button = await find('[data-report-refresh]', container);
    fireEvent.click(button);
    const note = await find('[data-report-note]', container);
    expect(note.textContent).toContain('refreshed');
    expect(note.textContent).toContain('read 4 people');
    expect(calls).toContainEqual({ what: 'taskRun', arg: { runId: 'r1', tenant: 'o1' } });
    expect(calls.findIndex((c) => c.what === 'updateSource')).toBeLessThan(calls.findIndex((c) => c.what === 'sync'));
  });

  it('saves what the configure dialog says', async () => {
    const { container } = render(<ReportsScreen />);
    fireEvent.click(await find('[data-report-configure]', container));
    const select = (await find('[data-source-connection]')) as HTMLSelectElement;
    // Only the GitHub connections are offered.
    expect([...select.options].map((o) => o.value)).toEqual(['', 'c1']);
    fireEvent.change(select, { target: { value: 'c1' } });
    fireEvent.change(document.querySelector('[data-source-plan-file]') as HTMLElement, {
      target: { value: 'acme/plans:other.yaml@main' },
    });
    fireEvent.click(document.querySelector('[data-source-save]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-source-note]')?.textContent).toBe('saved'));
    expect(calls).toContainEqual({
      what: 'updateSource',
      arg: { connection_id: 'c1', plan_file: 'acme/plans:other.yaml@main', board: '', roots: [], consumers: {} },
    });
  });

  it('edits the plan and says when somebody saved it first', async () => {
    serve({
      updatePlan: () => Promise.reject(Object.assign(new Error('stale'), { response: { status: 409 } })),
    });
    const { container } = render(<ReportsScreen />);
    fireEvent.click(await find('[data-report-configure]', container));
    fireEvent.click(await find('[data-plan-toggle]'));
    await find('[data-plan-editor]');
    fireEvent.click(document.querySelector('[data-plan-tab="people"]') as HTMLElement);
    const login = await waitFor(() => screen.getByDisplayValue('octo'));
    fireEvent.change(login, { target: { value: 'octocat' } });
    fireEvent.click(document.querySelector('[data-plan-save]') as HTMLElement);
    const note = await find('[data-plan-note]');
    expect(note.textContent).toBe('plan_stale');
    expect(document.querySelector('[data-plan-reload]')).not.toBeNull();
  });

  it('saves a plan section and publishes the teams', async () => {
    const { container } = render(<ReportsScreen />);
    fireEvent.click(await find('[data-report-configure]', container));
    fireEvent.click(await find('[data-plan-toggle]'));
    await find('[data-plan-editor]');
    fireEvent.change(screen.getByDisplayValue('Northwind'), { target: { value: 'Southwind' } });
    fireEvent.click(document.querySelector('[data-plan-save]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-plan-note]')?.textContent).toBe('saved'));
    expect(calls).toContainEqual({ what: 'updatePlan', arg: 'units' });
    fireEvent.click(document.querySelector('[data-plan-publish]') as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector('[data-plan-note]')?.textContent).toBe('Studio domain model: 3 written, 1 unchanged.')
    );
  });
});
