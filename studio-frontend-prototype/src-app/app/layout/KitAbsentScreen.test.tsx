/**
 * Scenario: a kit's screen opened where its kit is not installed (an old link,
 * a pin) says so over the screen, as a tab of it would not show.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { emit, state } = vi.hoisted(() => ({
  emit: vi.fn(),
  state: {
    registered: [] as unknown[],
    mounted: [] as unknown[],
    section: null as string | null,
    installed: null as ReadonlySet<string> | null,
    types: null as ReadonlySet<string> | null,
  },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: { emit, on: vi.fn() },
  useDomainExtensions: () => state.registered,
  useAppSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ 'app/context': { section: state.section } }),
}));
vi.mock('@/app/mfe/domainOccupancy', () => ({ useMountedExtensions: () => state.mounted }));
vi.mock('./useInstalledKits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useInstalledKits')>()),
  useInstalledKits: () => state.installed,
  useInstalledTypes: () => state.types,
}));
vi.mock('@/app/i18n/shellTranslations', () => ({
  useShellText: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

import { KitAbsentScreen } from './KitAbsentScreen';

const ext = (id: string, entry: string, presentation: Record<string, unknown>) => ({ id, entry, presentation });
const owner = ext('projects.main', 'entry.projects', { label: 'Projects', route: '/projects', level: 'workspace' });
const overview = ext('projects.overview', 'entry.projects', { label: 'Overview', route: '/projects/overview', level: 'project', section: 'overview' });
const artifacts = ext('projects.artifacts', 'entry.projects', {
  label: 'Artifacts', route: '/projects/artifacts', level: 'project', section: 'artifacts', kit: 'project-artifacts',
});
const activity = ext('activity.activity', 'entry.activity', {
  label: 'Activity', route: '/projects/activity', level: 'project', section: 'activity', kit: 'project-activity',
});
const timeline = ext('activity.timeline', 'entry.activity', {
  label: 'Timeline', route: '/projects/timeline', level: 'project', section: 'timeline', kit: 'project-activity', needs: ['milestone'],
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(state, { registered: [], mounted: [], section: null, installed: null, types: null });
});

describe('KitAbsentScreen', () => {
  const at = (mounted: unknown, section: string | null) => {
    state.registered = [owner, overview, artifacts, activity, timeline];
    state.mounted = [mounted];
    state.section = section;
  };

  it('draws nothing while the installed kits are unknown, or for the shell’s own screens', () => {
    at(activity, 'activity');
    const { container, rerender } = render(<KitAbsentScreen />);
    expect(container.innerHTML).toBe('');
    state.installed = new Set();
    at(owner, 'overview');
    rerender(<KitAbsentScreen />);
    expect(container.innerHTML).toBe('');
  });

  it('draws nothing where the kit is installed', () => {
    at(activity, 'activity');
    state.installed = new Set(['project-activity']);
    const { container } = render(<KitAbsentScreen />);
    expect(container.innerHTML).toBe('');
  });

  it('says a kit’s screen is not available where its kit is not installed, and offers the level’s home', () => {
    at(activity, 'activity');
    state.installed = new Set(['project-team']);
    render(<KitAbsentScreen />);
    expect(screen.getByRole('alert').textContent).toContain('screen_unknown_kit:Activity,project-activity');
    fireEvent.click(screen.getByRole('button', { name: 'screen_unknown_home' }));
    expect(emit).toHaveBeenCalledWith('app/context/level/requested', { level: 'project' });
  });

  it('judges a section of the owner’s micro-frontend by its own kit', () => {
    at(owner, 'artifacts');
    state.installed = new Set(['project-activity']);
    render(<KitAbsentScreen />);
    expect(document.querySelector('[data-kit-absent-screen]')?.getAttribute('data-kit-absent-screen')).toBe('project-artifacts');
  });

  it('says a section needs a type the kits here do not bring', () => {
    at(activity, 'timeline');
    state.installed = new Set(['project-activity']);
    state.types = new Set(['project']);
    render(<KitAbsentScreen />);
    expect(screen.getByRole('alert').textContent).toContain('screen_needs_types:Timeline,milestone');
  });
});
