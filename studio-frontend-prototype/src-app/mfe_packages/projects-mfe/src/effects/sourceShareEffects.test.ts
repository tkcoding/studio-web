import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSource } from '@constructor-studio/mfe-shared';

type BusHandler = (payload?: unknown) => void;

const { listeners, writeProjectSources } = vi.hoisted(() => ({
  listeners: new Map<string, BusHandler>(),
  writeProjectSources: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: {
    on: vi.fn((name: string, handler: BusHandler) => {
      listeners.set(name, handler);
      return { unsubscribe: () => listeners.delete(name) };
    }),
    emit: vi.fn(),
  },
}));

vi.mock('./projectSourcesEffects', () => ({ writeProjectSources }));

import type { AppDispatch, FrontXApp } from '@gears-frontx/react';
import { initSourceShareEffects } from './sourceShareEffects';
import { shareSaveDone, shareSaveFailed, shareSaveStarted } from '../slices/sourceShareSlice';

const API: ProjectSource = {
  connection_id: 'c-1',
  full_path: 'acme/api',
  clone_url: 'https://github.com/acme/api.git',
  branch: 'main',
};
const WEB: ProjectSource = { ...API, full_path: 'acme/web', clone_url: 'https://github.com/acme/web.git' };

function harness() {
  const dispatch = vi.fn();
  initSourceShareEffects(dispatch as unknown as AppDispatch, {} as FrontXApp);
  const request = () =>
    listeners.get('mfe/projects/source-share-mode-requested')?.({
      projectId: 'p-1',
      rowId: 'c-1:acme/api',
      connectionId: 'c-1',
      fullPath: 'acme/api',
      mode: 'pull_request',
    });
  return { dispatch, request };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a source's Changes", () => {
  beforeEach(() => {
    listeners.clear();
    writeProjectSources.mockReset();
  });

  it('writes the one entry’s share mode and nothing else, then clears the save', async () => {
    writeProjectSources.mockResolvedValue([]);
    const h = harness();
    h.request();
    expect(h.dispatch).toHaveBeenCalledWith(shareSaveStarted({ rowId: 'c-1:acme/api', mode: 'pull_request' }));
    await settle();

    expect(writeProjectSources.mock.calls[0]?.[1]).toBe('p-1');
    const change = writeProjectSources.mock.calls[0]?.[2] as (s: ProjectSource[]) => ProjectSource[];
    expect(change([API, WEB])).toEqual([{ ...API, share_mode: 'pull_request' }, WEB]);
    expect(h.dispatch).toHaveBeenLastCalledWith(shareSaveDone('c-1:acme/api'));
  });

  it('says "not saved" when the write is refused', async () => {
    writeProjectSources.mockRejectedValue(new Error('403'));
    const h = harness();
    h.request();
    await settle();
    expect(h.dispatch).toHaveBeenLastCalledWith(shareSaveFailed('c-1:acme/api'));
  });
});
