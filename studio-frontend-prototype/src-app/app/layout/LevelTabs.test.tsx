import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const SCREEN_DOMAIN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';

const people = {
  id: 'ext.people',
  domain: SCREEN_DOMAIN,
  entry: 'entry.people',
  presentation: {
    label: 'People',
    icon: 'lucide:users',
    route: '/people',
    order: 30,
    level: 'organization',
  },
};
const connections = {
  id: 'ext.connections',
  domain: SCREEN_DOMAIN,
  entry: 'entry.connections',
  presentation: {
    label: 'Connections',
    icon: 'lucide:plug',
    route: '/connections',
    order: 40,
    level: 'organization',
  },
};
const settings = {
  id: 'ext.organization',
  domain: SCREEN_DOMAIN,
  entry: 'entry.organization',
  presentation: {
    label: 'Settings',
    icon: 'lucide:settings',
    route: '/organization',
    order: 100,
    level: 'organization',
    placement: 'settings',
  },
};
const projects = {
  id: 'ext.projects',
  domain: SCREEN_DOMAIN,
  entry: 'entry.projects',
  presentation: {
    label: 'Projects',
    icon: 'lucide:folder',
    route: '/projects',
    order: 20,
    level: 'workspace',
  },
};
const overview = {
  id: 'ext.project.overview',
  domain: SCREEN_DOMAIN,
  entry: 'entry.projects',
  presentation: {
    label: 'Overview',
    icon: 'lucide:layout-dashboard',
    route: '/projects/overview',
    order: 10,
    level: 'project',
    section: 'overview',
  },
};
const artifacts = {
  id: 'ext.project.artifacts',
  domain: SCREEN_DOMAIN,
  entry: 'entry.projects',
  presentation: {
    label: 'Artifacts',
    icon: 'lucide:file-text',
    route: '/projects/artifacts',
    order: 20,
    level: 'project',
    section: 'artifacts',
  },
};
const editor = {
  id: 'ext.space',
  domain: SCREEN_DOMAIN,
  entry: 'entry.space',
  presentation: {
    label: 'Editor',
    icon: 'lucide:file-code',
    route: '/space',
    order: 900,
    level: 'project',
    placement: 'hidden',
    parentSection: 'artifacts',
  },
};

const { mockEventBus, mockRegistry, bootstrapState, registered, mounted, level, section } =
  vi.hoisted(() => ({
    mockEventBus: { emit: vi.fn() },
    mockRegistry: { executeActionsChain: vi.fn() },
    bootstrapState: { status: 'ready' as 'pending' | 'ready' | 'failed' },
    registered: { value: [] as unknown[] },
    mounted: { value: [] as unknown[] },
    level: { value: 'organization' as 'organization' | 'workspace' | 'project' },
    section: { value: null as string | null },
  }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: mockRegistry }),
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ 'app/mfe-bootstrap': bootstrapState, 'app/context': { section: section.value } }),
  useDomainExtensions: () => registered.value,
  eventBus: mockEventBus,
}));
const { installedKits } = vi.hoisted(() => ({
  installedKits: { value: null as ReadonlySet<string> | null },
}));
vi.mock('./useInstalledKits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useInstalledKits')>()),
  useInstalledKits: () => installedKits.value,
  useInstalledTypes: () => installedTypes.value,
}));
const { installedTypes } = vi.hoisted(() => ({
  installedTypes: { value: null as ReadonlySet<string> | null },
}));
vi.mock('@/app/mfe/domainOccupancy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/mfe/domainOccupancy')>()),
  useMountedExtensions: () => mounted.value,
}));

// The Studio domain model's tabs and the level's hidden ones (useModelTabs.ts):
// none and nothing hidden unless a test says otherwise.
const { modelTabsValue, hiddenValue, saveHidden } = vi.hoisted(() => ({
  modelTabsValue: { value: [] as { name: string; label: string; target: string }[] },
  hiddenValue: { value: [] as string[] },
  saveHidden: { value: null as null | ((next: string[]) => Promise<void>) },
}));
vi.mock('./useModelTabs', () => ({
  useLevelModelTabs: () => modelTabsValue.value,
  useLevelTenant: () => 'tenant-1',
  useHiddenTabs: () => ({ hidden: hiddenValue.value, save: saveHidden.value }),
}));

vi.mock('@/app/i18n/shellTranslations', () => ({ useShellText: () => (key: string) => key }));
vi.mock('./useScreenLevel', () => ({ useScreenLevel: () => level.value }));
// The kits' slot at the end of the row has its own suite (KitSlot.test.tsx).
vi.mock('./KitSlot', () => ({ KitSlot: () => null }));
vi.mock('./OrganizationRequests', () => ({ useDecidesRequests: () => false }));

import { LevelTabs } from './LevelTabs';
import { setPreferenceStoreForTests, type PreferenceStore } from '@/app/preferences/uiPreferences';
import { resetPinsForTests } from '@/app/pins/usePins';
import { PINS_KEY } from '@/app/pins/pins';

/** The person's preferences, in memory: what the tabs read and write. */
function fakePreferences(initial: Record<string, string> = {}) {
  let prefs: Record<string, string> = { ...initial };
  const listeners = new Set<() => void>();
  const store: PreferenceStore = {
    get: () => prefs,
    set: vi.fn((key: string, value: string) => {
      const next = { ...prefs };
      if (value) next[key] = value;
      else delete next[key];
      prefs = next;
      for (const listener of listeners) listener();
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load: () => Promise.resolve(),
  };
  return store;
}

/** The section tabs only, in the order drawn — not the row's Pin and Default order. */
const tabLabels = () =>
  Array.from(document.querySelectorAll('[data-tab]')).map((element) => element.textContent);


const tab = (name: string) => screen.getByRole('button', { name });

describe('LevelTabs (the level navigation)', () => {
  beforeEach(() => {
    setPreferenceStoreForTests(fakePreferences());
    localStorage.removeItem(PINS_KEY);
    resetPinsForTests();
    level.value = 'organization';
    section.value = null;
    bootstrapState.status = 'ready';
    // Deliberately out of order: the tabs sort, the registry does not.
    registered.value = [settings, connections, people, projects];
    mounted.value = [people];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists the items of the level in scope, in order, settings last', () => {
    render(<LevelTabs />);
    expect(tabLabels()).toEqual(['People', 'Connections', 'Settings']);
  });

  it('leaves out the items of another level', () => {
    render(<LevelTabs />);
    expect(screen.queryByText('Projects')).toBeNull();
  });

  it('is a navigation landmark', () => {
    render(<LevelTabs />);
    expect(screen.getByRole('navigation', { name: 'level_tabs' })).toBeTruthy();
  });

  // The tabs name the screen and stop there: leaving the project scope and the
  // mount itself belong to the shell, and are covered in appContextEffects.
  it('names the chosen screen to the shell', () => {
    render(<LevelTabs />);
    fireEvent.click(tab('Connections'));
    expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/screen/requested', {
      extensionId: 'ext.connections',
    });
  });

  it('mounts nothing itself', () => {
    render(<LevelTabs />);
    fireEvent.click(tab('Connections'));
    expect(mockRegistry.executeActionsChain).not.toHaveBeenCalled();
  });

  it('marks the mounted screen as the current page', () => {
    render(<LevelTabs />);
    expect(tab('People').getAttribute('aria-current')).toBe('page');
    expect(tab('Connections').getAttribute('aria-current')).toBeNull();
  });

  it('draws the row at a level with a single tab', () => {
    level.value = 'workspace';
    mounted.value = [projects];
    render(<LevelTabs />);
    expect(tab('Projects').getAttribute('aria-current')).toBe('page');
  });

  describe('sections of one screen', () => {
    beforeEach(() => {
      level.value = 'project';
      registered.value = [overview, artifacts, editor, people];
      mounted.value = [overview];
      section.value = 'overview';
    });

    // Same event for a section as for any other item: telling them apart is
    // the shell's job, since only it knows what is mounted right now.
    it('names the section the same way as any other item', () => {
      render(<LevelTabs />);
      fireEvent.click(tab('Artifacts'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/screen/requested', {
        extensionId: 'ext.project.artifacts',
      });
    });

    it('does not decide by itself that the project is being left', () => {
      render(<LevelTabs />);
      fireEvent.click(tab('Artifacts'));
      expect(mockEventBus.emit).not.toHaveBeenCalledWith('app/context/project/closed');
    });

    it('marks the active tab by the section, since every item shares one entry', () => {
      section.value = 'artifacts';
      render(<LevelTabs />);
      expect(tab('Artifacts').getAttribute('aria-current')).toBe('page');
      expect(tab('Overview').getAttribute('aria-current')).toBeNull();
    });

    it('keeps a hidden screen out of the row', () => {
      render(<LevelTabs />);
      expect(screen.queryByText('Editor')).toBeNull();
    });

    it('marks the section a mounted hidden screen belongs to', () => {
      mounted.value = [editor];
      section.value = null;
      render(<LevelTabs />);
      expect(tab('Artifacts').getAttribute('aria-current')).toBe('page');
      expect(tab('Overview').getAttribute('aria-current')).toBeNull();
    });

    // project-team's Team: a tab under the projects token, in its own
    // micro-frontend, named by the section it declares (routing mounts it).
    const team = {
      id: 'ext.team',
      domain: SCREEN_DOMAIN,
      entry: 'entry.team',
      presentation: { label: 'Team', route: '/projects/team', order: 60, level: 'project', section: 'team', kit: 'project-team' },
    };

    it('asks for a kit’s tab in a micro-frontend of its own by its section', () => {
      registered.value = [overview, artifacts, team];
      render(<LevelTabs />);
      fireEvent.click(tab('Team'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/screen/requested', { extensionId: 'ext.team' });
    });

    it('marks the kit’s tab, and only it, while its micro-frontend shows', () => {
      registered.value = [overview, artifacts, team];
      mounted.value = [team];
      section.value = 'team';
      render(<LevelTabs />);
      expect(tab('Team').getAttribute('aria-current')).toBe('page');
      expect(tab('Overview').getAttribute('aria-current')).toBeNull();
    });
  });

  it('holds a placeholder while the manifest is still in flight', () => {
    registered.value = [];
    bootstrapState.status = 'pending';
    const { container } = render(<LevelTabs />);
    // Unknown, not empty: an empty row would claim the level has no sections.
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('is absent once a failed bootstrap leaves no items', () => {
    registered.value = [];
    bootstrapState.status = 'failed';
    const { container } = render(<LevelTabs />);
    expect(container.firstChild).toBeNull();
  });
});

describe('LevelTabs: the order a person keeps (tab-order.ts, /me/ui-preferences)', () => {
  beforeEach(() => {
    localStorage.removeItem(PINS_KEY);
    resetPinsForTests();
    level.value = 'organization';
    section.value = null;
    bootstrapState.status = 'ready';
    registered.value = [settings, connections, people, projects];
    mounted.value = [people];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setPreferenceStoreForTests(null);
  });

  it('draws the tabs in the stored order of their level', () => {
    setPreferenceStoreForTests(fakePreferences({ 'organization.tabs.order': 'organization,connections' }));
    render(<LevelTabs />);
    // People was never stored: it keeps its default place, first, in front of the stored ones.
    expect(tabLabels()).toEqual(['People', 'Settings', 'Connections']);
  });

  it('reads the order of another level as nothing', () => {
    setPreferenceStoreForTests(fakePreferences({ 'project.tabs.order': 'connections' }));
    render(<LevelTabs />);
    expect(tabLabels()).toEqual(['People', 'Connections', 'Settings']);
  });

  it('moves a focused tab with Alt+Shift+arrow, and stores the order', () => {
    const store = fakePreferences();
    setPreferenceStoreForTests(store);
    render(<LevelTabs />);
    fireEvent.keyDown(tab('Connections'), { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(store.set).toHaveBeenCalledWith('organization.tabs.order', 'connections,people,organization');
    expect(tabLabels()).toEqual(['Connections', 'People', 'Settings']);
  });

  it('ignores a plain arrow, and a move past the end', () => {
    const store = fakePreferences();
    setPreferenceStoreForTests(store);
    render(<LevelTabs />);
    fireEvent.keyDown(tab('Connections'), { key: 'ArrowLeft' });
    fireEvent.keyDown(tab('People'), { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('stores nothing for the default order', () => {
    const store = fakePreferences({ 'organization.tabs.order': 'connections,people,organization' });
    setPreferenceStoreForTests(store);
    render(<LevelTabs />);
    fireEvent.keyDown(tab('Connections'), { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(store.set).toHaveBeenCalledWith('organization.tabs.order', '');
  });

  it('offers the default order back only while another one is kept', () => {
    const store = fakePreferences({ 'organization.tabs.order': 'connections,people' });
    setPreferenceStoreForTests(store);
    render(<LevelTabs />);
    fireEvent.click(screen.getByRole('button', { name: 'level_tabs_default_order' }));
    expect(store.set).toHaveBeenCalledWith('organization.tabs.order', '');
    expect(screen.queryByRole('button', { name: 'level_tabs_default_order' })).toBeNull();
  });

  it('moves a dragged tab to where it is dropped', () => {
    const store = fakePreferences();
    setPreferenceStoreForTests(store);
    render(<LevelTabs />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tab('Settings'), { dataTransfer });
    // jsdom lays nothing out: every box is 0 wide at 0, so a pointer left of 0 lands in front.
    fireEvent.dragOver(tab('People'), { dataTransfer, clientX: -1 });
    fireEvent.drop(tab('People'), { dataTransfer, clientX: -1 });
    expect(store.set).toHaveBeenCalledWith('organization.tabs.order', 'organization,people,connections');
  });
});

describe('LevelTabs: Pin (pins.ts)', () => {
  beforeEach(() => {
    setPreferenceStoreForTests(fakePreferences());
    localStorage.removeItem(PINS_KEY);
    resetPinsForTests();
    level.value = 'organization';
    section.value = null;
    bootstrapState.status = 'ready';
    registered.value = [settings, connections, people, projects];
    mounted.value = [people];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setPreferenceStoreForTests(null);
  });

  it('pins the section on screen, and unpins it again', () => {
    render(<LevelTabs />);
    const button = () => document.querySelector('[data-pin-toggle]') as HTMLElement;
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([
      { route: { token: 'people' }, label: 'People', where: [] },
    ]);
    fireEvent.click(button());
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toEqual([]);
  });

  it('offers no pin while no tab is on screen', () => {
    mounted.value = [];
    render(<LevelTabs />);
    expect(document.querySelector('[data-pin-toggle]')).toBeNull();
  });
});

describe("LevelTabs: the Studio domain model's tabs and the hidden ones (ADR-0066)", () => {
  const attributes = {
    id: 'ext.model.attributes',
    domain: SCREEN_DOMAIN,
    entry: 'entry.admin',
    presentation: {
      label: 'Attributes',
      icon: 'lucide:file-text',
      route: '/model-organization/attributes',
      order: 95,
      level: 'organization',
      section: 'attributes',
    },
  };
  const generic = {
    id: 'ext.model.types',
    domain: SCREEN_DOMAIN,
    entry: 'entry.admin',
    presentation: {
      label: 'Domain model tab',
      icon: 'lucide:list',
      route: '/model-organization/types',
      order: 999,
      level: 'organization',
      section: 'type:',
      sectionPrefix: true,
      placement: 'hidden',
    },
  };

  beforeEach(() => {
    setPreferenceStoreForTests(fakePreferences());
    localStorage.removeItem(PINS_KEY);
    resetPinsForTests();
    level.value = 'organization';
    section.value = 'attributes';
    bootstrapState.status = 'ready';
    registered.value = [settings, connections, people, attributes, generic];
    mounted.value = [attributes];
    modelTabsValue.value = [
      { name: 'people', label: 'Members', target: 'person' },
      { name: 'cost_centres', label: 'Cost centres', target: 'cost-centre' },
    ];
    hiddenValue.value = [];
    saveHidden.value = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setPreferenceStoreForTests(null);
    modelTabsValue.value = [];
    hiddenValue.value = [];
    saveHidden.value = null;
  });

  it('draws a relation no screen answers as a tab after the built-in ones, before Settings', () => {
    render(<LevelTabs />);
    // `people` is People's own tab: it keeps its label, and is not drawn twice.
    expect(tabLabels()).toEqual(['People', 'Connections', 'Attributes', 'Cost centres', 'Settings']);
  });

  it('opens the generic screen under the tab’s section', () => {
    render(<LevelTabs />);
    fireEvent.click(tab('Cost centres'));
    expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/screen/requested', {
      extensionId: 'ext.model.types',
      section: 'type:cost_centres',
    });
  });

  it('marks the tab of the section on screen as the current page', () => {
    section.value = 'type:cost_centres';
    render(<LevelTabs />);
    expect(tab('Cost centres').getAttribute('aria-current')).toBe('page');
    expect(tab('Attributes').getAttribute('aria-current')).toBeNull();
  });

  it('leaves out what the level hides, by model name', () => {
    hiddenValue.value = ['type:cost_centres', 'connections'];
    render(<LevelTabs />);
    expect(tabLabels()).toEqual(['People', 'Attributes', 'Settings']);
  });

  it('offers Customize only where the level has a settings document', () => {
    render(<LevelTabs />);
    expect(document.querySelector('[data-tabs-customize]')).toBeNull();
  });

  it('previews a tab switched off and saves the names that are off', async () => {
    const save = vi.fn(() => Promise.resolve());
    saveHidden.value = save;
    hiddenValue.value = ['releases'];
    render(<LevelTabs />);
    fireEvent.click(document.querySelector('[data-tabs-customize]') as HTMLElement);
    fireEvent.click(screen.getAllByRole('switch')[0]);
    // The first switch is People's: gone from the row before anything is saved.
    expect(tabLabels()).not.toContain('People');
    fireEvent.click(document.querySelector('[data-tabs-save]') as HTMLElement);
    // `releases` is not a tab here (a kit not installed): its hiding is kept.
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(['people', 'releases']));
  });
});

describe('LevelTabs and kits (ADR-0069 §4)', () => {
  it('shows a kit\'s tab only where the kit is installed, and while that is unknown', async () => {
    const { screenShows } = await import('./useInstalledKits');
    const kitTab = { id: 'tests', presentation: { label: 'Tests', route: '/tests', level: 'project', kit: 'project-tests' } };
    const shellTab = { id: 'specs', presentation: { label: 'Specs', route: '/projects/specs', level: 'project' } };
    expect(screenShows(kitTab as never, null)).toBe(true);
    expect(screenShows(kitTab as never, new Set(['project-tests']))).toBe(true);
    expect(screenShows(kitTab as never, new Set())).toBe(false);
    expect(screenShows(shellTab as never, new Set())).toBe(true);
  });

  it('shows a section that needs another kit\'s type only where the type is installed (ADR-0070 §2)', async () => {
    const { screenShows } = await import('./useInstalledKits');
    const timeline = {
      id: 'timeline',
      presentation: { label: 'Timeline', route: '/projects/timeline', level: 'project', kit: 'project-activity', needs: ['milestone'] },
    };
    const kits = new Set(['project-activity']);
    // Unknown hides nothing.
    expect(screenShows(timeline as never, kits, null)).toBe(true);
    expect(screenShows(timeline as never, kits, new Set(['milestone', 'project']))).toBe(true);
    // project-lifecycle not installed, or the type dormant: the model has no milestone.
    expect(screenShows(timeline as never, kits, new Set(['project']))).toBe(false);
    // The kit itself still decides first.
    expect(screenShows(timeline as never, new Set(), new Set(['milestone']))).toBe(false);
  });

  it('drops a tab whose needed type the organization lacks', () => {
    level.value = 'project';
    const activity = {
      id: 'ext.activity',
      domain: SCREEN_DOMAIN,
      entry: 'entry.activity',
      presentation: { label: 'Activity', icon: 'lucide:activity', route: '/projects/activity', order: 60, level: 'project', section: 'activity' },
    };
    const timeline = {
      id: 'ext.timeline',
      domain: SCREEN_DOMAIN,
      entry: 'entry.activity',
      presentation: { label: 'Timeline', icon: 'lucide:milestone', route: '/projects/timeline', order: 61, level: 'project', section: 'timeline', needs: ['milestone'] },
    };
    registered.value = [activity, timeline];
    installedTypes.value = new Set(['project']);
    render(<LevelTabs />);
    expect(screen.queryByText('Activity')).not.toBeNull();
    expect(screen.queryByText('Timeline')).toBeNull();
    cleanup();
    installedTypes.value = new Set(['project', 'milestone']);
    render(<LevelTabs />);
    expect(screen.queryByText('Timeline')).not.toBeNull();
    installedTypes.value = null;
  });
});
