import { describe, expect, it } from 'vitest';
import type { Tenant } from '@constructor-studio/mfe-shared';
import type { OrgOverview, OrgWorkspace } from '../../overview/types';
import { healthOf, matchesManaged, visibleWorkspaces, workspaceSummary } from './model';

const ws = (name: string, extra: Partial<Tenant> = {}): Tenant =>
  ({ id: name.toLowerCase(), name, status: 'active', self_managed: false, depth: 2, child_count: 1, created_at: '', updated_at: '', ...extra }) as Tenant;

const health = (projects: OrgWorkspace['projects']): OrgWorkspace => ({
  id: 'w',
  name: 'W',
  spend: null,
  previous: null,
  specs_failing: 0,
  stuck: 0,
  quiet_days: null,
  score: 0,
  projects,
});

const project = (name: string, reasons: OrgWorkspace['projects'][number]['reasons'] = []) => ({
  id: name,
  name,
  spend: null,
  previous: null,
  specs_failing: null,
  open_findings: null,
  stuck: 0,
  quiet_days: null,
  broken: false,
  score: 0,
  reasons,
});

describe('workspaces model', () => {
  it('keeps self-managed, organization-managed or every workspace', () => {
    const self = ws('A', { self_managed: true });
    const org = ws('B');
    expect([matchesManaged(self, 'self'), matchesManaged(org, 'self')]).toEqual([true, false]);
    expect([matchesManaged(self, 'org'), matchesManaged(org, 'org')]).toEqual([false, true]);
    expect([matchesManaged(self, 'all'), matchesManaged(org, 'all')]).toEqual([true, true]);
  });

  it('searches by name, filters by management and sorts by name', () => {
    const rows = [ws('Zeta'), ws('alpha', { self_managed: true }), ws('Beta')];
    expect(visibleWorkspaces(rows, '', 'all').map((r) => r.name)).toEqual(['alpha', 'Beta', 'Zeta']);
    expect(visibleWorkspaces(rows, ' ET ', 'all').map((r) => r.name)).toEqual(['Beta', 'Zeta']);
    expect(visibleWorkspaces(rows, '', 'self').map((r) => r.name)).toEqual(['alpha']);
  });

  it('finds a workspace in the overview by id', () => {
    const o = { workspaces: [{ ...health([]), id: 'x' }] } as unknown as OrgOverview;
    expect(healthOf(o, 'x')?.id).toBe('x');
    expect(healthOf(o, 'y')).toBeUndefined();
    expect(healthOf(null, 'x')).toBeUndefined();
  });

  it('names the worst project and why when one is in trouble', () => {
    const h = health([project('api', [{ kind: 'stuck', value: 2 }]), project('web')]);
    expect(workspaceSummary(ws('W'), h, 7)).toMatch(/^api: /);
  });

  it('lists the projects by name otherwise, and says self-managed', () => {
    expect(workspaceSummary(ws('W'), health([project('api'), project('web')]), 7)).toBe('api, web');
    expect(workspaceSummary(ws('W', { self_managed: true }), health([]), 7)).toBe('Self-managed · no projects yet');
  });

  it('without the overview says only what the account system knows', () => {
    expect(workspaceSummary(ws('W', { child_count: 0 }), undefined, 7)).toBe('No projects yet');
    expect(workspaceSummary(ws('W', { child_count: 3 }), undefined, 7)).toBe('');
    expect(workspaceSummary(ws('W', { child_count: 3, self_managed: true }), undefined, 7)).toBe('Self-managed');
  });
});
