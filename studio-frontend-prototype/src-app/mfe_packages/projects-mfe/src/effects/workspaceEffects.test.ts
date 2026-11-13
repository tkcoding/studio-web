import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BusHandler = (payload?: unknown) => void | Promise<void>;

const { listeners, mockEmit, mockGetService } = vi.hoisted(() => ({
  listeners: new Map<string, BusHandler[]>(),
  mockEmit: vi.fn(),
  mockGetService: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: {
    on: vi.fn((eventName: string, handler: BusHandler) => {
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), handler]);
      return { unsubscribe: () => listeners.delete(eventName) };
    }),
    emit: mockEmit,
  },
  apiRegistry: { getService: mockGetService },
}));

import { type AppDispatch } from '@gears-frontx/react';
import { initWorkspaceEffects } from './workspaceEffects';
import { workspaceSubmitFailed, workspaceSubmitStarted } from '../slices/workspaceSlice';

const CREATED = { id: 'ws-9', name: 'Platform' };

let createWorkspace: ReturnType<typeof vi.fn>;
let dispatch: ReturnType<typeof vi.fn>;

/** Awaited: the write is a promise the handler does not return. */
async function request(payload: { orgId: string; name: string }): Promise<void> {
  await Promise.all(
    (listeners.get('mfe/workspaces/create-requested') ?? []).map((handler) => handler(payload))
  );
  await vi.waitFor(() => {
    if (createWorkspace.mock.calls.length === 0) throw new Error('not written yet');
  });
  await Promise.resolve();
}

describe('the organization a workspace is created under', () => {
  beforeEach(() => {
    listeners.clear();
    mockEmit.mockClear();
    createWorkspace = vi.fn().mockResolvedValue(CREATED);
    mockGetService.mockReturnValue({ createWorkspace });
    dispatch = vi.fn();
    initWorkspaceEffects(dispatch as unknown as AppDispatch);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is the one named by the request, used as the tenant parent', async () => {
    await request({ orgId: 'org-1', name: 'Platform' });

    expect(dispatch).toHaveBeenCalledWith(workspaceSubmitStarted());
    expect(createWorkspace).toHaveBeenCalledWith({ name: 'Platform', parentId: 'org-1' });
  });

  it('travels back out on the answer, so the announcement can name its scope', async () => {
    await request({ orgId: 'org-1', name: 'Platform' });

    expect(mockEmit).toHaveBeenCalledWith('mfe/workspaces/created', {
      id: CREATED.id,
      name: 'Platform',
      orgId: 'org-1',
    });
  });

  it('is the submitted one even when the write resolves much later', async () => {
    let settle: (tenant: typeof CREATED) => void = () => {};
    createWorkspace.mockReturnValue(
      new Promise<typeof CREATED>((resolve) => {
        settle = resolve;
      })
    );

    await Promise.all(
      (listeners.get('mfe/workspaces/create-requested') ?? []).map((handler) =>
        handler({ orgId: 'org-1', name: 'Platform' })
      )
    );
    settle(CREATED);
    await vi.waitFor(() => {
      if (mockEmit.mock.calls.length === 0) throw new Error('not announced yet');
    });

    expect(mockEmit).toHaveBeenCalledWith('mfe/workspaces/created', {
      id: CREATED.id,
      name: 'Platform',
      orgId: 'org-1',
    });
  });

  it('is not announced at all when the write is refused', async () => {
    createWorkspace.mockRejectedValue(new Error('nope'));

    await request({ orgId: 'org-1', name: 'Platform' });
    await vi.waitFor(() => {
      if (dispatch.mock.calls.length < 2) throw new Error('not refused yet');
    });

    expect(mockEmit).not.toHaveBeenCalledWith('mfe/workspaces/created', expect.anything());
    // The refusal's own wording is `refusalFrom`'s business, not this test's.
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: workspaceSubmitFailed.type }) as never
    );
  });

  // A name that is only whitespace is not a name, and nothing is written for
  // it — so no organization is claimed either.
  it('is never claimed for a request with an empty name', async () => {
    await Promise.all(
      (listeners.get('mfe/workspaces/create-requested') ?? []).map((handler) =>
        handler({ orgId: 'org-1', name: '   ' })
      )
    );

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
