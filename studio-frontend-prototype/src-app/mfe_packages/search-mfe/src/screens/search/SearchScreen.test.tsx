import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { properties, accounts, search } = vi.hoisted(() => ({
  properties: new Map<string, unknown>(),
  accounts: {
    workspaces: vi.fn(),
    projects: vi.fn(),
  },
  search: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gears-frontx/react')>();
  return {
    ...actual,
    useSharedProperty: (id: string) => properties.get(id),
    apiRegistry: {
      getService: (service: { name: string }) =>
        service.name === 'SearchApiService'
          ? { artifacts: { fetch: (body: unknown) => search(body) } }
          : {
              getWorkspaces: (args: unknown) => ({ fetch: () => accounts.workspaces(args) }),
              getProjects: (args: { parentId: string }) => ({ fetch: () => accounts.projects(args) }),
            },
    },
  };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
}));
vi.mock('../../i18n', () => ({
  useSearchTranslations: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(',')}` : key),
    loading: false,
  }),
}));

import {
  STUDIO_ACTION_ARTIFACT_OPEN,
  STUDIO_ACTION_PLACE_OPEN,
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
} from '@constructor-studio/mfe-shared';
import { FRONTX_ACTION_UNMOUNT_EXT, FRONTX_OVERLAY_DOMAIN } from '@gears-frontx/react';
import { SearchScreen } from './SearchScreen';

const executeActionsChain = vi.fn();
const bridge = { extensionId: 'ext.search', executeActionsChain } as unknown as ChildMfeBridge;
const sent = () => executeActionsChain.mock.calls.map(([chain]) => (chain as { action: { type: string; target: string; payload: unknown } }).action);

const typeIn = (text: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });

describe('SearchScreen', () => {
  beforeEach(() => {
    properties.set(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION, { id: 'o1', name: 'Acme' });
    properties.set(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE, { id: 'w1', name: 'Web' });
    accounts.workspaces.mockResolvedValue({ items: [{ id: 'w1', name: 'Web' }, { id: 'w2', name: 'Data' }] });
    accounts.projects.mockImplementation(async ({ parentId }: { parentId: string }) => ({
      items: parentId === 'w1' ? [{ id: 'p1', name: 'Portal' }] : [{ id: 'p2', name: 'Pipeline' }],
    }));
    search.mockResolvedValue({ nodes: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    properties.clear();
  });

  it('without an organization, says where to start and asks nothing', () => {
    properties.clear();
    render(<SearchScreen bridge={bridge} />);
    expect(screen.getByText('no_organization')).toBeTruthy();
    expect(accounts.workspaces).not.toHaveBeenCalled();
  });

  it('finds projects by name across the organization’s workspaces, and goes to one', async () => {
    render(<SearchScreen bridge={bridge} />);
    typeIn('pip');
    fireEvent.click(await screen.findByText('Pipeline'));
    expect(screen.getByText('in_workspace:Data')).toBeTruthy();
    expect(sent()).toEqual([
      { type: STUDIO_ACTION_PLACE_OPEN, target: FRONTX_OVERLAY_DOMAIN, payload: { organizationId: 'o1', workspaceId: 'w2', projectId: 'p2' } },
      { type: FRONTX_ACTION_UNMOUNT_EXT, target: FRONTX_OVERLAY_DOMAIN, payload: { subject: 'ext.search' } },
    ]);
  });

  it('opens a file of the workspace on screen in the IDE, with the keyboard', async () => {
    search.mockResolvedValue({
      nodes: [
        {
          type_id: 'gts.cf.studio.artifact.file.v1~',
          instance_id: 'n1',
          value: { path: 'docs/prd.md', project_id: 'p1', workspace_id: 'w1' },
        },
      ],
      total: 1,
    });
    render(<SearchScreen bridge={bridge} />);
    typeIn('prd');
    expect(await screen.findByText('prd.md')).toBeTruthy();
    expect(search).toHaveBeenCalledWith({ text: 'prd', limit: 20 });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(sent()[0]).toEqual({
      type: STUDIO_ACTION_ARTIFACT_OPEN,
      target: FRONTX_OVERLAY_DOMAIN,
      payload: { projectId: 'p1', artifactId: 'n1', repository: '', path: 'docs/prd.md', kind: 'file' },
    });
  });

  it('says when the sources could not be searched, and when the workspaces could not be read', async () => {
    search.mockRejectedValue(new Error('graph is down'));
    accounts.workspaces.mockRejectedValue(new Error('403'));
    render(<SearchScreen bridge={bridge} />);
    typeIn('portal');
    await waitFor(() => expect(document.querySelector('[data-artifacts-failed]')?.textContent).toBe('artifacts_failed:graph is down'));
    expect(document.querySelector('[data-places-failed]')?.textContent).toBe('places_failed:403');
  });

  it('says so when a workspace’s projects could not be read, instead of passing them over', async () => {
    accounts.projects.mockRejectedValueOnce(new Error('nope'));
    render(<SearchScreen bridge={bridge} />);
    typeIn('data');
    await waitFor(() => expect(document.querySelector('[data-places-partial]')).toBeTruthy());
  });
});
