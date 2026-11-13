import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionDto } from '@constructor-studio/mfe-shared';

/** What the row menu's items do (DoDs `...-sources-menu-sync`, `...-sources-menu-specs`). */

const { connections, emit, dispatch, bridge, announceSection, detachView } = vi.hoisted(() => ({
  connections: { current: { connections: [] as ConnectionDto[], loading: false, failed: false } },
  emit: vi.fn(),
  dispatch: vi.fn(),
  bridge: { id: 'bridge' },
  announceSection: vi.fn(),
  detachView: { detach: () => undefined, detaching: new Set<string>() },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: { emit },
  useAppDispatch: () => dispatch,
  useMfeBridge: () => bridge,
}));
// One answer per state of the connections, as the hook's own memo gives.
const views = new WeakMap<object, object>();
vi.mock('./useConnections', () => ({
  useSourceConnections: () => {
    if (!views.has(connections.current)) {
      views.set(connections.current, {
        ...connections.current,
        byId: new Map(connections.current.connections.map((entry) => [entry.id, entry])),
        providerName: (p: string) => `name:${p}`,
      });
    }
    return views.get(connections.current);
  },
}));
vi.mock('../actions/projectsActions', () => ({ announceSection }));
vi.mock('./useSourceDetach', () => ({
  useSourceDetach: () => detachView,
}));

import { sourceRow } from '../model/sourceRows.fixture';
import { showSourceSpecs } from '../slices/specsFilterSlice';
import { useSourceRowActions } from './useSourceRowActions';

const connection = (id: string, provider: string): ConnectionDto =>
  ({ id, provider, label: id, base_url: '', secret_ref: `studio-connection-${id}` }) as ConnectionDto;

const ROW = sourceRow();

const render = () => renderHook(() => useSourceRowActions('p-1', 'ws-1', 'org-1')).result.current;

beforeEach(() => {
  vi.clearAllMocks();
  connections.current = {
    connections: [connection('c-github', 'github'), connection('c-gitlab', 'gitlab')],
    loading: false,
    failed: false,
  };
});

describe('Sync now', () => {
  it("adds the one repository to the project's import", () => {
    render().syncNow(ROW, false);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('mfe/artifacts/repos-added', {
      projectId: 'p-1',
      workspaceId: 'ws-1',
      repos: [
        {
          repo: 'acme/api',
          provider: 'github',
          baseUrl: undefined,
          secretRef: 'studio-connection-c-github',
        },
      ],
      unsyncable: [],
    });
  });

  it('retries the stopped run instead of asking for another', () => {
    render().syncNow(ROW, true);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('mfe/artifacts/retry-requested', {
      projectId: 'p-1',
      repo: 'acme/api',
    });
  });
});

it('Cancel sync asks the import to stop the run', () => {
  render().cancelSync(ROW);
  expect(emit).toHaveBeenCalledWith('mfe/artifacts/cancel-requested', {
    projectId: 'p-1',
    repo: 'acme/api',
  });
});

it('Open specs filters Specs to the path and asks the shell for the section', () => {
  render().openSpecs(ROW);
  expect(dispatch).toHaveBeenCalledWith(showSourceSpecs('acme/api'));
  expect(announceSection).toHaveBeenCalledWith(bridge, 'specs');
});

it("Changes asks for the row's share mode to be written, and nothing when it is unchanged", () => {
  render().changeShareMode(ROW, 'pull_request');
  expect(emit).toHaveBeenCalledWith('mfe/projects/source-share-mode-requested', {
    projectId: 'p-1',
    rowId: 'c-github:acme/api',
    connectionId: 'c-github',
    fullPath: 'acme/api',
    mode: 'pull_request',
  });
  emit.mockClear();
  render().changeShareMode(ROW, 'branch');
  expect(emit).not.toHaveBeenCalled();
});

it('says whether the connections were read', () => {
  expect(render().connectionsRead).toBe(true);
  connections.current = { ...connections.current, failed: true };
  expect(render().connectionsRead).toBe(false);
  connections.current = { ...connections.current, failed: false, loading: true };
  expect(render().connectionsRead).toBe(false);
});

it('gives the same actions on every render while nothing they use changes', () => {
  const hook = renderHook(() => useSourceRowActions('p-1', 'ws-1', 'org-1'));
  const first = hook.result.current;

  hook.rerender();
  expect(hook.result.current).toBe(first);
});
