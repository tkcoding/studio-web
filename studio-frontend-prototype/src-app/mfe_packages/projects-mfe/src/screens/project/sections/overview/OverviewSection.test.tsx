import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectStatus } from '../../../../model/projectStatus';

const { query, openScreen, phaseRead, phaseSet, available, live } = vi.hoisted(() => ({
  available: { value: null as unknown },
  live: { value: null as unknown },
  query: vi.fn(),
  openScreen: vi.fn(),
  phaseRead: vi.fn(),
  phaseSet: vi.fn(),
}));

vi.mock('../../../../i18n', () => ({
  useOverviewSectionTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({
      status: () => ({}),
      phase: () => ({ fetch: phaseRead }),
      setPhase: () => ({ fetch: phaseSet }),
    }),
  },
  useApiQuery: query,
  useMfeBridge: () => null,
  useSharedProperty: (id: string) =>
    id.includes('screens.available') ? available.value : id.includes('last_event') ? live.value : null,
}));

import { OverviewSection } from './OverviewSection';

const blocked: ProjectStatus = {
  project_id: 'p1',
  verdict: 'blocked',
  label: 'Blocked',
  reason: 'last build failed',
  more: 1,
  signals: [
    {
      key: 'build',
      level: 'blocked',
      phrase: 'last build failed',
      detail: 'at abc1234',
      action: { label: 'Open Releases', target: 'releases' },
    },
    {
      key: 'nobody',
      level: 'risk',
      phrase: '2 pull requests with no reviewer',
      detail: null,
      action: { label: 'Show pull requests', target: 'pulls' },
    },
  ],
  path: [
    { step: 'repos', title: 'Connect a repository', state: 'done', flow: 'done', status: '1 repository, synced.', tab: 'sources', action: 'Open Sources' },
    { step: 'types', title: 'Type the documents', state: 'current', flow: 'current', status: '74 of 75 documents typed.', tab: 'specs', action: 'Open Specs' },
    { step: 'build', title: 'Build it', state: 'unknown', flow: 'later', status: 'CI runs not readable', tab: 'releases', action: 'Open Releases' },
  ],
  next: 'types',
  unread: ['builds', 'deployments'],
};

const ok = (data: ProjectStatus) => ({ data, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn() });

describe('OverviewSection', () => {
  beforeEach(() => {
    available.value = null;
    openScreen.mockReset();
    query.mockReturnValue(ok(blocked));
    phaseRead.mockReset();
    phaseSet.mockReset();
    // Project lifecycle not installed: no phase anywhere.
    phaseRead.mockResolvedValue({ project_id: 'p1', installed: false, phase: null, phase_owner: null, phase_since: null, states: [], next: [] });
  });

  it('shows no phase where Project lifecycle does not apply', async () => {
    render(<OverviewSection projectId="p1" />);
    await vi.waitFor(() => expect(phaseRead).toHaveBeenCalled());
    expect(document.querySelector('[data-project-phase]')).toBeNull();
  });

  it('shows the phase and moves it along the lifecycle where the kit applies', async () => {
    const at = (phase: string, next: { transition: string; to: string }[]) => ({
      project_id: 'p1',
      installed: true,
      phase,
      phase_owner: 'u1',
      phase_since: '2026-11-10T10:00:00Z',
      states: ['idea', 'discovery', 'build', 'run'],
      next,
    });
    phaseRead.mockResolvedValue(at('idea', [{ transition: 'discover', to: 'discovery' }]));
    phaseSet.mockResolvedValue(at('discovery', [{ transition: 'build', to: 'build' }]));
    render(<OverviewSection projectId="p1" />);
    expect(await screen.findByText('phase_idea')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'phase_move {"phase":"phase_discovery"}' }));
    expect(await screen.findByText('phase_discovery')).toBeTruthy();
    expect(phaseSet).toHaveBeenCalledWith({ phase: 'discovery' });
    expect(document.querySelector('[data-project-phase]')?.getAttribute('data-project-phase')).toBe('discovery');
  });

  it('shows the verdict, its reason and how many more', () => {
    render(<OverviewSection projectId="p1" />);
    expect(screen.getByText('Blocked').closest('[data-verdict]')?.getAttribute('data-verdict')).toBe('blocked');
    expect(screen.getAllByText('last build failed').length).toBeGreaterThan(0);
    expect(screen.getByText('more_below {"count":1}')).toBeTruthy();
  });

  it('makes the next step the primary action and opens its screen', () => {
    render(<OverviewSection projectId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Specs' }));
    expect(openScreen).toHaveBeenCalledWith(null, '/projects/specs');
    fireEvent.click(screen.getByRole('button', { name: 'open_ide' }));
    expect(openScreen).toHaveBeenLastCalledWith(null, '/space');
  });

  it('opens Open IDE as the primary action once the path is done', () => {
    query.mockReturnValue(ok({ ...blocked, next: null }));
    render(<OverviewSection projectId="p1" />);
    expect(screen.getAllByRole('button', { name: 'open_ide' })).toHaveLength(1);
  });

  it('lists the signals with an action only where this portal has the screen', () => {
    render(<OverviewSection projectId="p1" />);
    expect(document.querySelector('[data-attention="build"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Releases' }));
    expect(openScreen).toHaveBeenCalledWith(null, '/releases');
    // The pull request list is not in this portal: no dead button.
    expect(screen.queryByRole('button', { name: 'Show pull requests' })).toBeNull();
  });

  it("offers no button to a kit's tab where that kit is not installed for the project", () => {
    // Releases (product-releases) and Specs (project-specs) are not installed here.
    available.value = { routes: ['/projects/overview', '/projects/sources', '/space'], kits: [] };
    render(<OverviewSection projectId="p1" />);
    expect(screen.queryByRole('button', { name: 'Open Releases' })).toBeNull();
    // The next step's screen is missing too: Open IDE is the primary action.
    expect(document.querySelector('[data-next-step]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'open_ide' })).toHaveLength(1);
    // A step whose screen shows keeps its button.
    fireEvent.click(document.querySelector('[data-path-step="repos"]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Open Sources' }));
    expect(openScreen).toHaveBeenLastCalledWith(null, '/projects/sources');
  });

  it('asks for the kit each signal and step names, not only for its route', () => {
    // The route shows, but the signal's kit is gone since the status was read.
    available.value = {
      routes: ['/projects/overview', '/projects/sources', '/projects/specs', '/releases', '/space'],
      kits: ['project-specs'],
    };
    const named: ProjectStatus = {
      ...blocked,
      signals: blocked.signals.map((s) => ({ ...s, kit: s.key === 'build' ? 'product-releases' : 'project-git' })),
      path: blocked.path.map((p) => ({ ...p, kit: p.step === 'types' ? 'project-specs' : p.step === 'build' ? 'product-releases' : null })),
      kits: ['project-specs'],
    };
    query.mockReturnValue(ok(named));
    render(<OverviewSection projectId="p1" />);
    expect(document.querySelector('[data-attention="build"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Releases' })).toBeNull();
    // Specs is installed: its step stays the next one, with its button.
    expect(document.querySelector('[data-next-step]')).toBeTruthy();
  });

  it('reads the status again when a background run ends, not while one runs', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    query.mockReturnValue({ ...ok(blocked), refetch });
    live.value = null;
    const view = render(<OverviewSection projectId="p1" />);
    const run = (seq: number, state: string) => ({
      seq,
      at_ms: seq,
      kind: `task.${state}`,
      subject_type: 'task_run',
      subject_id: `r${seq}`,
      source: 'studio-tasks',
      payload: { run_id: `r${seq}`, state },
    });
    live.value = run(1, 'running');
    view.rerender(<OverviewSection projectId="p1" />);
    vi.advanceTimersByTime(1000);
    expect(refetch).not.toHaveBeenCalled();
    live.value = run(2, 'succeeded');
    view.rerender(<OverviewSection projectId="p1" />);
    vi.advanceTimersByTime(1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    live.value = null;
    vi.useRealTimers();
  });

  it('names the sources it could not read', () => {
    render(<OverviewSection projectId="p1" />);
    expect(screen.getByText('not_read {"sources":"builds, deployments"}')).toBeTruthy();
  });

  it('draws the path with its progress, and a step opens its line and button', () => {
    render(<OverviewSection projectId="p1" />);
    expect(screen.getByText('path_progress {"done":1,"total":3}')).toBeTruthy();
    const unknown = document.querySelector('[data-path-step="build"]') as HTMLElement;
    expect(unknown.getAttribute('data-flow')).toBe('later');
    fireEvent.click(unknown);
    expect(screen.getByText('step_unknown {"status":"CI runs not readable"}')).toBeTruthy();
  });

  it('shows a 503 as studio-mcp being down, not as an empty project', () => {
    query.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }),
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<OverviewSection projectId="p1" />);
    expect(screen.getByRole('alert').textContent).toContain('status_unavailable');
    expect(screen.queryByText('nothing_waits')).toBeNull();
  });

  it('says plainly when nothing waits', () => {
    query.mockReturnValue(ok({ ...blocked, verdict: 'on_track', label: 'On track', signals: [], unread: [], more: 0 }));
    render(<OverviewSection projectId="p1" />);
    expect(screen.getByText('nothing_waits')).toBeTruthy();
  });
});
