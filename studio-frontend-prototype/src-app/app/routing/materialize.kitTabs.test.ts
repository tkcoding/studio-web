/**
 * Scenario: a kit's tab under a token another micro-frontend owns.
 *
 * project-activity's Activity and Timeline (`/projects/activity`,
 * `/projects/timeline`) and project-team's Team (`/projects/team`) are tabs of
 * the project level in micro-frontends of their own, under the projects
 * micro-frontend's token. A cold deep link to one, and a click between them
 * and the owner's sections, must mount the right micro-frontend; a section a
 * runtime kit brings under a shell token waits for the kits like a kit's own
 * token does (issue #1006).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrontXApp } from '@gears-frontx/react';

const { SCREEN_DOMAIN, mocks } = vi.hoisted(() => ({
  SCREEN_DOMAIN: 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1',
  mocks: {
    mounted: [] as string[],
    mountScreen: vi.fn(),
    publish: vi.fn(),
  },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  screenDomain: { id: SCREEN_DOMAIN },
}));
vi.mock('@/app/mfe/mountScreen', () => ({ mountScreen: mocks.mountScreen }));
vi.mock('@/app/mfe/sharedContext', () => ({ publishStudioContext: mocks.publish }));
vi.mock('@/app/mfe/domainOccupancy', () => ({ occupancyOf: () => ({ mounted: () => mocks.mounted }) }));

import { freshNavigationHistory } from '@frontx-test-utils/memoryNavigationHistory';
import { screen } from '@frontx-test-utils/screenFixture';
import reducer, { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { createShellNavigation } from './navigation';
import { groupScreens } from './screenTokens';
import { createMaterializer, screenFor } from './materialize';
import { unresolvedScreenOf } from './unresolvedScreen';

const own = (ext: StudioScreenExtension, entry: string): StudioScreenExtension => ({ ...ext, entry }) as StudioScreenExtension;

const builtIn = [
  screen('org.workspaces', '/organization/workspaces', 'organization', { section: 'workspaces', order: 20 }),
  screen('projects.main', '/projects', 'workspace', { order: 20 }),
  screen('projects.overview', '/projects/overview', 'project', { section: 'overview', order: 10 }),
  screen('projects.artifacts', '/projects/artifacts', 'project', { section: 'artifacts', order: 20 }),
];
const activity = own(
  screen('activity.activity', '/projects/activity', 'project', { section: 'activity', order: 60, kit: 'project-activity' }),
  'entry.activity'
);
const timeline = own(
  screen('activity.timeline', '/projects/timeline', 'project', { section: 'timeline', order: 61, kit: 'project-activity' }),
  'entry.activity'
);
const team = own(
  screen('team.main', '/projects/team', 'project', { section: 'team', order: 62, kit: 'project-team', modelTab: 'people' }),
  'entry.team'
);
const withKits = [...builtIn, activity, timeline, team];

const ORG = { id: 'o1', name: 'Org' };
const WS = { id: 'w1', name: 'Work' };
const ATLAS = { id: 'p1', name: 'Atlas' };
const inProject: Partial<AppContextState> = {
  org: ORG,
  orgs: [ORG],
  access: 'ready',
  workspace: WS,
  workspaces: [WS],
  workspacesStatus: 'ready',
  projects: [ATLAS],
};
const AT = '/?screen=projects;org=o1;workspace=w1;project=p1';

function setup(url: string, extensions: StudioScreenExtension[], runtime?: Set<string>) {
  const { history, adapter } = freshNavigationHistory(url);
  const navigation = createShellNavigation(history);
  let state: AppContextState = { ...reducer(undefined, { type: '@@init' }), ...inProject };
  const app = {
    store: {
      dispatch: (action: unknown) => {
        state = reducer(state, action as never);
      },
      getState: () => ({ [APP_CONTEXT_SLICE_KEY]: state }),
    },
    mfeRegistry: { getExtensionsForDomain: () => extensions },
  } as unknown as FrontXApp;
  let groups = groupScreens(extensions);
  const catalogs = { loadOrganizations: vi.fn(), loadWorkspaces: vi.fn(), loadProjects: vi.fn(), resolveProject: vi.fn() };
  const warn = vi.fn();
  const materializer = createMaterializer({
    app,
    navigation,
    groups: () => groups,
    catalogs,
    warn,
    ...(runtime && { runtime: { isSettled: (scope: string) => runtime.has(scope) }, waitMs: 1000 }),
  });
  /** What `startRouting` does when the runtime kits register a package. */
  const register = (extension: StudioScreenExtension) => {
    extensions.push(extension);
    groups = groupScreens(extensions);
  };
  return {
    ...materializer,
    adapter,
    navigation,
    warn,
    register,
    state: () => state,
    unresolved: () => unresolvedScreenOf(app.mfeRegistry!).get(),
  };
}

const mountedId = () => (mocks.mountScreen.mock.lastCall?.[1] as StudioScreenExtension | undefined)?.id;
const go = (h: ReturnType<typeof setup>, section: string) => {
  h.navigation.navigate({ token: 'projects', org: 'o1', workspace: 'w1', project: 'p1', section }, 'push');
  h.transition();
};

beforeEach(() => {
  mocks.mounted = [];
  mocks.mountScreen.mockImplementation(async (_registry: unknown, ext: StudioScreenExtension) => {
    mocks.mounted = [ext.id];
  });
});
afterEach(() => vi.clearAllMocks());

describe('screenFor', () => {
  const [group] = groupScreens(withKits).filter((g) => g.token === 'projects');

  it('is the group’s owner for the owner’s own sections, and for none', () => {
    expect(screenFor(group, 'project', 'artifacts').id).toBe('projects.main');
    expect(screenFor(group, 'project', undefined).id).toBe('projects.main');
    expect(screenFor(group, 'workspace', undefined).id).toBe('projects.main');
  });

  it('is the kit’s member for a section it brings in a micro-frontend of its own', () => {
    expect(screenFor(group, 'project', 'activity').id).toBe('activity.activity');
    expect(screenFor(group, 'project', 'timeline').id).toBe('activity.timeline');
    expect(screenFor(group, 'project', 'team').id).toBe('team.main');
  });
});

describe('materialize: a kit’s tab under a token another micro-frontend owns', () => {
  it('opens a cold deep link to the kit’s tab in the kit’s own micro-frontend', () => {
    const h = setup(`${AT};section=activity`, [...withKits]);
    h.materialize();
    expect(mocks.mountScreen).toHaveBeenCalledTimes(1);
    expect(mountedId()).toBe('activity.activity');
    expect(h.state().section).toBe('activity');
    expect(h.adapter.url()).toBe(`${AT};section=activity`);
  });

  it('opens Team, a kit tab with a section of its own, cold', () => {
    const h = setup(`${AT};section=team`, [...withKits]);
    h.materialize();
    expect(mountedId()).toBe('team.main');
  });

  it('switches micro-frontends between the owner’s sections and the kit’s, and not within one', async () => {
    const h = setup(`${AT};section=overview`, [...withKits]);
    h.materialize();
    expect(mountedId()).toBe('projects.main');
    await vi.waitFor(() => expect(mocks.mounted).toEqual(['projects.main']));
    mocks.mountScreen.mockClear();

    // The owner's own sections: its micro-frontend switches by the published section.
    go(h, 'artifacts');
    expect(mocks.mountScreen).not.toHaveBeenCalled();

    go(h, 'activity');
    expect(mountedId()).toBe('activity.activity');
    await vi.waitFor(() => expect(mocks.mounted).toEqual(['activity.activity']));
    mocks.mountScreen.mockClear();

    // Activity and Timeline are one micro-frontend: no remount between them.
    go(h, 'timeline');
    expect(mocks.mountScreen).not.toHaveBeenCalled();
    expect(h.state().section).toBe('timeline');

    go(h, 'team');
    expect(mountedId()).toBe('team.main');
    await vi.waitFor(() => expect(mocks.mounted).toEqual(['team.main']));

    go(h, 'overview');
    expect(mountedId()).toBe('projects.main');
  });

  it('falls back to the project’s Overview, in the project, when a kit’s tab does not mount', async () => {
    mocks.mountScreen.mockImplementation(async (_registry: unknown, ext: StudioScreenExtension) => {
      if (ext.id === 'activity.activity') throw new Error('remoteEntry.js 404');
      mocks.mounted = [ext.id];
    });
    const h = setup(`${AT};section=activity`, [...withKits]);
    h.materialize();
    await vi.waitFor(() => expect(h.adapter.url()).toBe(`${AT};section=overview`));
    await vi.waitFor(() => expect(mocks.mounted).toEqual(['projects.main']));
    expect(h.state().project?.id).toBe('p1');
  });

  it('falls back from a project screen of another token to the project’s entry point, keeping the project', async () => {
    const generic = own(
      screen('model.project', '/model-project/types', 'project', { section: 'type:', sectionPrefix: true, order: 900 }),
      'entry.admin'
    );
    mocks.mountScreen.mockImplementation(async (_registry: unknown, ext: StudioScreenExtension) => {
      if (ext.id === 'model.project') throw new Error('remoteEntry.js 404');
      mocks.mounted = [ext.id];
    });
    const h = setup('/?screen=model-project;org=o1;workspace=w1;project=p1;section=type:milestones', [...withKits, generic]);
    h.materialize();
    await vi.waitFor(() => expect(h.adapter.url()).toBe(`${AT};section=overview`));
    await vi.waitFor(() => expect(mocks.mounted).toEqual(['projects.main']));
  });

  it('names the kit’s screen, not the owner, when it does not mount', async () => {
    mocks.mountScreen.mockImplementation(async () => {
      throw new Error('remoteEntry.js 404');
    });
    const h = setup(`${AT};section=activity`, [...withKits]);
    h.materialize();
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalled());
    expect(h.warn.mock.calls[0][0]).toContain('activity.activity at /projects/activity');
  });
});

describe('materialize: a cold deep link to a section a runtime kit brings under a shell token', () => {
  const LINK = `${AT};section=notes`;
  const notes = own(
    screen('notes.main', '/projects/notes', 'project', { section: 'notes', order: 70, kit: 'notes-kit' }),
    'entry.notes'
  );

  it('keeps the section and waits for the kits instead of opening the first tab', () => {
    const h = setup(LINK, [...builtIn], new Set());
    h.materialize();
    expect(h.adapter.url()).toBe(LINK);
    expect(h.unresolved()).toEqual({ token: 'projects', status: 'waiting', level: 'project' });
    expect(mocks.mountScreen).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('opens the kit’s tab once its kit registers it', () => {
    const settled = new Set<string>();
    const h = setup(LINK, [...builtIn], settled);
    h.materialize();
    h.register(notes);
    settled.add('project:p1');
    h.materialize();
    expect(h.unresolved()).toBeNull();
    expect(mountedId()).toBe('notes.main');
    expect(h.state().section).toBe('notes');
    expect(h.adapter.url()).toBe(LINK);
  });

  it('opens the group’s first tab, with a warning, once the kits settled without it', () => {
    const settled = new Set<string>();
    const h = setup(LINK, [...builtIn], settled);
    h.materialize();
    settled.add('project:p1');
    h.materialize();
    expect(h.unresolved()).toBeNull();
    expect(h.adapter.url()).toBe(`${AT};section=overview`);
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('"notes" is not a section of projects'));
    expect(mountedId()).toBe('projects.main');
  });

  it('stops waiting when the kits never settle', () => {
    vi.useFakeTimers();
    try {
      const h = setup(LINK, [...builtIn], new Set());
      h.materialize();
      expect(h.unresolved()?.status).toBe('waiting');
      vi.advanceTimersByTime(1000);
      expect(h.unresolved()).toBeNull();
      expect(h.adapter.url()).toBe(`${AT};section=overview`);
    } finally {
      vi.useRealTimers();
    }
  });
});
