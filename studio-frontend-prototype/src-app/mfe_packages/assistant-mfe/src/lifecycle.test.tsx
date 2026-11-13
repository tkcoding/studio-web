import { describe, expect, it, vi } from 'vitest';

vi.mock('./init', () => ({ mfeApp: { id: 'assistant-mfe-app' } }));
vi.mock('./screens/panel/AssistantPanel', () => ({ AssistantPanel: () => null }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  StudioMfeLifecycle: class StudioMfeLifecycle {
    constructor(public readonly app: unknown) {}
  },
}));

import lifecycle from './lifecycle';

describe('assistant-mfe lifecycle', () => {
  it('binds the kit app to the lifecycle the shell mounts', () => {
    expect((lifecycle as unknown as { app: unknown }).app).toEqual({ id: 'assistant-mfe-app' });
  });
});
