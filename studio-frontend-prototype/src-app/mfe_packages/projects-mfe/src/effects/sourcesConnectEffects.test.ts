import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';

type BusHandler = (payload?: unknown) => void;

const { listeners, emitted, writeProjectSources } = vi.hoisted(() => ({
  listeners: new Map<string, BusHandler>(),
  emitted: [] as [string, unknown][],
  writeProjectSources: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: {
    on: vi.fn((name: string, handler: BusHandler) => {
      listeners.set(name, handler);
      return { unsubscribe: () => listeners.delete(name) };
    }),
    emit: vi.fn((name: string, payload: unknown) => emitted.push([name, payload])),
  },
}));

vi.mock('./projectSourcesEffects', () => ({ writeProjectSources }));

import type { AppDispatch, FrontXApp } from '@gears-frontx/react';
import { initSourcesConnectEffects } from './sourcesConnectEffects';
import { attemptedInTab } from '../shared/importAttempts';
import { connectFailed } from '../slices/sourcesConnectSlice';
import type { RepositoryPick } from '../model/projectDraft';

const PROJECT = 'p-1';

const pick = (fullPath: string, connectionId: string, defaultBranch?: string): RepositoryPick => ({
  id: fullPath,
  fullPath,
  cloneUrl: `https://github.com/${fullPath}.git`,
  connectionId,
  ...(defaultBranch ? { defaultBranch } : {}),
});

const attached: ProjectSource = {
  connection_id: 'c-1',
  full_path: 'acme/api',
  clone_url: 'https://github.com/acme/api.git',
};

function harness() {
  const dispatch = vi.fn();
  initSourcesConnectEffects(dispatch as unknown as AppDispatch, {} as FrontXApp);
  const request = (picks: RepositoryPick[]) =>
    listeners.get('mfe/projects/sources-connect-requested')?.({ projectId: PROJECT, picks });
  return { dispatch, request };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Connect source writes the picks', () => {
  beforeEach(() => {
    listeners.clear();
    emitted.length = 0;
    writeProjectSources.mockReset();
    window.sessionStorage.clear();
  });

  it('appends each pick with its default branch and share mode, after the project already has', async () => {
    writeProjectSources.mockResolvedValue([]);
    const h = harness();
    h.request([pick('acme/web', 'c-1', 'main'), pick('lab/tool', 'c-2')]);
    await settle();

    const change = writeProjectSources.mock.calls[0]?.[2] as (s: ProjectSource[]) => ProjectSource[];
    expect(writeProjectSources.mock.calls[0]?.[1]).toBe(PROJECT);
    expect(change([attached])).toEqual([
      attached,
      {
        connection_id: 'c-1',
        full_path: 'acme/web',
        clone_url: 'https://github.com/acme/web.git',
        branch: 'main',
        share_mode: 'branch',
      },
      {
        connection_id: 'c-2',
        full_path: 'lab/tool',
        clone_url: 'https://github.com/lab/tool.git',
        share_mode: 'branch',
      },
    ]);
  });

  it('records the attempt before it writes, so the first import does not start on its own', async () => {
    writeProjectSources.mockImplementation(() => {
      expect(attemptedInTab(PROJECT)).toBe(true);
      return Promise.resolve([]);
    });
    const h = harness();
    h.request([pick('acme/web', 'c-1')]);
    await settle();

    expect(writeProjectSources).toHaveBeenCalledTimes(1);
  });

  it('says the sources are connected once the write succeeds', async () => {
    writeProjectSources.mockResolvedValue([]);
    const h = harness();
    h.request([pick('acme/web', 'c-1')]);
    await settle();

    expect(emitted).toEqual([['mfe/projects/sources-connected', { projectId: PROJECT }]]);
  });

  it('refuses a write that would take the project past 100 sources', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      connection_id: 'c-1',
      full_path: `old/repo-${index}`,
      clone_url: `https://github.com/old/repo-${index}.git`,
    }));
    writeProjectSources.mockImplementation(
      async (_app: unknown, _projectId: string, change: (s: ProjectSource[]) => ProjectSource[]) =>
        change(full)
    );
    const h = harness();
    h.request([pick('acme/web', 'c-1')]);
    await settle();

    expect(emitted).toEqual([]);
    const dispatched = h.dispatch.mock.calls.map(([action]) => action);
    expect(dispatched[dispatched.length - 1]).toEqual(
      connectFailed({ kind: 'i18n', key: 'error_too_many' })
    );
  });

  it('keeps the dialog open with the reason when the write is refused', async () => {
    writeProjectSources.mockRejectedValue(new Error('metadata refused'));
    const h = harness();
    h.request([pick('acme/web', 'c-1')]);
    await settle();

    expect(emitted).toEqual([]);
    const dispatched = h.dispatch.mock.calls.map(([action]) => action);
    expect(dispatched[dispatched.length - 1]).toMatchObject({
      type: expect.stringContaining('connectFailed'),
    });
  });
});
