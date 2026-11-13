import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

interface TestContext {
  org: { id: string; name: string; count?: number } | null;
  orgs: { id: string; name: string; count?: number }[];
  workspace: { id: string; name: string; count?: number } | null;
  workspaces: { id: string; name: string; count?: number }[];
  workspacesStatus: 'pending' | 'ready' | 'failed';
  project: { id: string; name: string } | null;
  projects: { id: string; name: string }[];
  loading: boolean;
}

const { mockEventBus, context, level, screens } = vi.hoisted(() => ({
  screens: [] as Array<{ id: string; presentation: { label: string; route: string; level?: string } }>,
  mockEventBus: { emit: vi.fn() },
  level: { value: 'organization' as 'organization' | 'workspace' | 'project' },
  context: { value: {} as TestContext },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ 'app/context': context.value }),
  eventBus: mockEventBus,
  useDomainExtensions: () => screens,
}));

vi.mock('@/app/i18n/shellTranslations', () => import('@frontx-test-utils/shellText'));

vi.mock('./useScreenLevel', () => ({ useScreenLevel: () => level.value }));

import { ContextChain } from './ContextChain';
import { createLogoStore, setLogoStoreForTests } from './orgLogo';
import { stubResizeObserver } from '@frontx-test-utils/stubResizeObserver';

// cmdk scrolls the highlighted row into view and measures its list; jsdom has
// no layout for either.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  stubResizeObserver();
});

describe('ContextChain (the path in the top bar)', () => {
  beforeEach(() => {
    level.value = 'organization';
    context.value = {
      org: { id: 'org-1', name: 'Acme Corporation', count: 3 },
      orgs: [
        { id: 'org-1', name: 'Acme Corporation', count: 3 },
        { id: 'org-2', name: 'Constructor Labs', count: 2 },
      ],
      workspace: { id: 'ws-1', name: 'Platform Workspace', count: 8 },
      workspaces: [
        { id: 'ws-1', name: 'Platform Workspace', count: 8 },
        { id: 'ws-2', name: 'Product Knowledge', count: 5 },
      ],
      workspacesStatus: 'ready',
      project: { id: 'p-1', name: 'Agent Platform' },
      projects: [
        { id: 'p-1', name: 'Agent Platform' },
        { id: 'p-2', name: 'Developer Portal' },
      ],
      loading: false,
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("the organization's logo (the prototype's OrgMark)", () => {
    afterEach(() => setLogoStoreForTests(null));

    it('shows the logo in the organization slot, and the glyph for one without', async () => {
      setLogoStoreForTests(
        createLogoStore((orgId) =>
          orgId === 'org-1'
            ? Promise.resolve({ content_type: 'image/png', data: 'AAAA' })
            : Promise.reject(new Error('404'))
        )
      );
      render(<ContextChain />);
      const slot = screen.getByRole('button', { name: 'Organization: Acme Corporation' });
      await vi.waitFor(() =>
        expect(slot.querySelector('[data-org-logo="org-1"]')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
      );
    });
  });

  describe('slots per level', () => {
    it('shows a skeleton in a slot whose name the shell has not resolved yet', () => {
      level.value = 'project';
      context.value.project = { id: 'p-9', name: '' };
      context.value.projects = [];
      render(<ContextChain />);
      expect(screen.getByTestId('context-slot-pending')).toBeTruthy();
      expect(screen.queryByText('p-9')).toBeNull();
      // Reviewer finding (vasylcf): the accessible name must not trail off into nothing.
      expect(screen.getByLabelText('Project: …')).toBeTruthy();
    });

    // The organization is named and switched in its header, not in the path.
    it('names the organization first at every level, under its level caption (ADR-0069)', () => {
      for (const value of ['organization', 'workspace', 'project'] as const) {
        level.value = value;
        render(<ContextChain />);
        expect(screen.getByRole('button', { name: 'Organization: Acme Corporation' })).toBeTruthy();
        cleanup();
      }
    });

    it('starts the path at the platform once a platform screen is registered', () => {
      screens.push({ id: 'kits', presentation: { label: 'Kits', route: '/kits', level: 'platform' } });
      render(<ContextChain />);
      fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/level/requested', { level: 'platform' });
      screens.length = 0;
    });

    it('keeps only the platform and the organization on the platform level', () => {
      screens.push({ id: 'kits', presentation: { label: 'Kits', route: '/kits', level: 'platform' } });
      level.value = 'platform' as never;
      render(<ContextChain />);
      expect(screen.getByRole('button', { name: 'Platform' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Organization: Acme Corporation' })).toBeTruthy();
      expect(screen.queryByText('All workspaces')).toBeNull();
      screens.length = 0;
    });

    it('holds the workspace slot alone at the organization level, naming none', () => {
      render(<ContextChain />);
      expect(screen.getByText('All workspaces')).toBeTruthy();
      expect(screen.queryByText('Platform Workspace')).toBeNull();
      expect(screen.queryByText('Agent Platform')).toBeNull();
    });

    it('holds a placeholder at the organization level while the workspaces are unread', () => {
      context.value.workspaces = [];
      context.value.workspacesStatus = 'pending';
      render(<ContextChain />);
      expect(screen.getByTestId('context-slot-pending')).toBeTruthy();
    });

    it('opens no empty menu from the placeholder', () => {
      context.value.workspaces = [];
      context.value.workspacesStatus = 'pending';
      render(<ContextChain />);
      fireEvent.click(screen.getByRole('button', { name: 'Workspace: …' }));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('draws no workspace slot for an organization that has no workspace', () => {
      context.value.workspaces = [];
      render(<ContextChain />);
      expect(screen.queryByText('All workspaces')).toBeNull();
      expect(screen.getByRole('button', { name: 'Organization: Acme Corporation' })).toBeTruthy();
    });

    it('keeps the project out of the path until one is open', () => {
      level.value = 'workspace';
      render(<ContextChain />);
      expect(screen.getByText('Platform Workspace')).toBeTruthy();
      expect(screen.queryByText('Agent Platform')).toBeNull();
    });

    it('shows the workspace and the project at the project level', () => {
      level.value = 'project';
      render(<ContextChain />);
      expect(screen.getByText('Platform Workspace')).toBeTruthy();
      expect(screen.getByText('Agent Platform')).toBeTruthy();
    });

    it('skips a level nothing is selected at', () => {
      level.value = 'project';
      context.value.project = null;
      render(<ContextChain />);
      expect(screen.getByText('Platform Workspace')).toBeTruthy();
      expect(screen.queryByText('Agent Platform')).toBeNull();
    });

    it('draws no path below the organization while no workspace is selected', () => {
      level.value = 'workspace';
      context.value.workspace = null;
      render(<ContextChain />);
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('renders nothing at all before an organization resolves', () => {
      context.value.org = null;
      const { container } = render(<ContextChain />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('switching', () => {
    // One announcement carries the workspace and the level it asks for.
    it('enters the workspace picked at the organization level', async () => {
      render(<ContextChain />);
      fireEvent.click(screen.getByText('All workspaces'));
      fireEvent.click(await screen.findByText('Product Knowledge'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/workspace/changed', {
        workspaceId: 'ws-2',
        enter: true,
      });
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        'app/context/level/requested',
        expect.anything()
      );
    });

    it('announces a workspace pick from its own slot', async () => {
      level.value = 'workspace';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Platform Workspace'));
      fireEvent.click(await screen.findByText('Product Knowledge'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/workspace/changed', {
        workspaceId: 'ws-2',
      });
    });

    it('marks the slot of the level in scope as the current page', () => {
      level.value = 'project';
      render(<ContextChain />);
      expect(screen.getByText('Agent Platform').closest('button')?.getAttribute('aria-current')).toBe(
        'page'
      );
      expect(
        screen.getByText('Platform Workspace').closest('button')?.getAttribute('aria-current')
      ).toBeNull();
    });

    it('enters the level of the slot that was picked in', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Platform Workspace'));
      fireEvent.click(await screen.findByText('Product Knowledge'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/level/requested', {
        level: 'workspace',
      });
    });

    it('stays put when the pick is a sibling of the level in scope', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      fireEvent.click(await screen.findByText('Developer Portal'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/project/changed', {
        projectId: 'p-2',
      });
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        'app/context/level/requested',
        expect.anything()
      );
    });
  });

  describe('the level above', () => {
    it('leads from the workspace slot to the organization', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Platform Workspace'));
      fireEvent.click(await screen.findByText('All workspaces'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/level/requested', {
        level: 'organization',
      });
    });

    it('leads from the project slot to the workspace', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      fireEvent.click(await screen.findByText('Projects in Platform Workspace'));
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/level/requested', {
        level: 'workspace',
      });
    });
  });

  describe('the project search', () => {
    it('filters the projects by name', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      fireEvent.change(await screen.findByPlaceholderText('Search projects…'), {
        target: { value: 'portal' },
      });
      expect(await screen.findByText('Developer Portal')).toBeTruthy();
      expect(screen.queryAllByText('Agent Platform')).toHaveLength(1);
    });

    it('opens on the search field', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      const search = await screen.findByRole('searchbox', { name: 'Search projects…' });
      await vi.waitFor(() => expect(document.activeElement).toBe(search));
    });

    it('announces nothing when the open project is picked, and closes', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      fireEvent.click(await screen.findByRole('option', { name: 'Agent Platform' }));
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        'app/context/project/changed',
        expect.anything()
      );
      await vi.waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
    });

    it('opens again with an empty search', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'portal' } });
      fireEvent.click(await screen.findByRole('option', { name: 'Developer Portal' }));
      await vi.waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull());
      fireEvent.click(screen.getByText('Agent Platform'));
      expect((await screen.findByRole('searchbox') as HTMLInputElement).value).toBe('');
    });

    it('opens the first project found on Enter', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      const search = await screen.findByRole('searchbox', { name: 'Search projects…' });
      fireEvent.change(search, { target: { value: 'portal' } });
      await screen.findByText('Developer Portal');
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/project/changed', {
        projectId: 'p-2',
      });
    });
  });

  // The design's menus name each workspace and nothing else; counts live in the
  // organization switch and on the Workspaces screen.
  describe('the menus', () => {
    it('lists the workspaces without counting their projects', async () => {
      level.value = 'workspace';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Platform Workspace'));
      expect(await screen.findByText('Product Knowledge')).toBeTruthy();
      expect(screen.queryByText(/projects?$/)).toBeNull();
    });

    it('says nothing under a project, whose artifacts nobody has counted', async () => {
      level.value = 'project';
      render(<ContextChain />);
      fireEvent.click(screen.getByText('Agent Platform'));
      expect(await screen.findByText('Developer Portal')).toBeTruthy();
      expect(screen.queryByText(/artifact/)).toBeNull();
    });
  });
});
