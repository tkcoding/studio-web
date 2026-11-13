import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgOverview } from '../../overview/types';

const { query, available, openScreen, requestWorkspace } = vi.hoisted(() => ({
  query: vi.fn(),
  available: { value: null as unknown },
  openScreen: vi.fn(),
  requestWorkspace: vi.fn(),
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key} ${count}`;
  return { useOverviewTranslations: () => ({ t, loading: false }) };
});
// The Inbox has its own test (InboxGroup.test.tsx): here it reports one item waiting on the reader.
vi.mock('./InboxGroup', async () => {
  const { useEffect } = await import('react');
  return {
    InboxGroup: ({ onCount }: { onCount?: (n: number) => void }) => {
      useEffect(() => onCount?.(1), [onCount]);
      return <div data-attention-group="you" />;
    },
  };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'o1', name: 'Acme' }, loading: false, failed: false }),
  openScreen,
}));
vi.mock('../../actions/workspaceActions', () => ({ requestWorkspace }));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => ({ overview: () => ({}) }) },
  useApiQuery: query,
  useSharedProperty: (id: string) => (id.includes('screens.available') ? available.value : 'en'),
  useMfeBridge: () => null,
}));

import { OverviewScreen } from './OverviewScreen';

const overview: OrgOverview = {
  organization_id: 'o1',
  name: 'Acme',
  period_from: '',
  period_to: '',
  previous_from: '',
  previous_to: '',
  stuck_days: 7,
  growth_alert: 0.2,
  quiet_days: 14,
  costs: 'shown',
  needs: [{ kind: 'connection', tone: 'danger', provider: 'github', status: '401', projects: ['app'] }],
  spend: { currency: 'USD', current: 120, previous: 100, forecast: 180, own_keys: 0, attributed: 0, unattributed: 0, sessions: 0, unpriced: [] },
  delivery: { merged: 12, window_days: 30, open: 4, median_wait_days: 2 },
  specs: { specs: 10, failing: 1, open_findings: 5 },
  people: { active: 6, with_spend: 3, per_person: 20, idle: [] },
  workspaces: [
    { id: 'w1', name: 'Main', spend: null, previous: null, specs_failing: 0, stuck: 0, quiet_days: 1, score: 0, projects: [] },
  ],
  money: null,
  waiting_on: null,
  decisions: null,
};

describe('OverviewScreen', () => {
  beforeEach(() => {
    query.mockReturnValue({ data: overview, isLoading: false, isError: false, error: null });
    available.value = null;
    openScreen.mockReset();
    requestWorkspace.mockReset();
  });

  it("opens a kit's screen only where its kit is installed: Costs and Components", () => {
    const withSpend = {
      ...overview,
      needs: [
        { kind: 'spend', tone: 'warn', projects: [], current: 150, previous: 100, forecast: 200 },
        { kind: 'components', tone: 'warn', projects: [], components: 2 },
      ],
    } as unknown as OrgOverview;
    query.mockReturnValue({ data: withSpend, isLoading: false, isError: false, error: null });
    available.value = { routes: ['/organization/workspaces', '/people', '/costs'], kits: ['org-costs'] };
    render(<OverviewScreen />);
    // The spend tile and the spend row open Costs, whose kit is installed.
    fireEvent.click(screen.getByRole('button', { name: 'open_costs' }));
    expect(openScreen).toHaveBeenLastCalledWith(null, '/costs');
    // Components (`components` kit) is not installed here: no tile, no row button.
    expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'open_people' }));
    expect(openScreen).toHaveBeenLastCalledWith(null, '/people');
  });

  it('offers no button to a screen the shell does not list', () => {
    available.value = { routes: ['/organization/workspaces'], kits: [] };
    render(<OverviewScreen />);
    expect(screen.queryByRole('button', { name: 'Fix the connection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'open_costs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'open_people' })).toBeNull();
    expect(screen.getByRole('button', { name: 'open_workspaces' })).toBeTruthy();
  });

  it('opens a workspace from its row', () => {
    render(<OverviewScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'open_workspace' }));
    expect(requestWorkspace).toHaveBeenCalledWith(null, { id: 'w1', name: 'Main' }, 'o1');
  });

  it('names the refused connection, the figures and the workspaces', () => {
    render(<OverviewScreen />);
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('A github connection is refused (401)')).toBeTruthy();
    expect(screen.getByText(/"merged":"12"/)).toBeTruthy();
    expect(screen.getByText('Main')).toBeTruthy();
    // The refused connection for others, and one item for the reader.
    expect(screen.getByText('2 things need attention')).toBeTruthy();
    expect(document.querySelector('[data-attention-group="you"]')).toBeTruthy();
    // A refused connection is fixed on Connections, which this portal has.
    expect(screen.getByRole('button', { name: 'Fix the connection' })).toBeTruthy();
  });

  it('says when the overview cannot be read', () => {
    query.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('403') });
    render(<OverviewScreen />);
    expect(screen.getByText('unreadable')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
