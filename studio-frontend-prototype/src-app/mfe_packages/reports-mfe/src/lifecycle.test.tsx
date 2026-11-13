import { describe, expect, it, vi } from 'vitest';

const { superMountSpy } = vi.hoisted(() => ({ superMountSpy: vi.fn() }));

vi.mock('./init', () => ({ mfeApp: { id: 'reports-mfe-app' } }));
vi.mock('./screens/reports/ReportsScreen', () => ({ ReportsScreen: () => null }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  StudioMfeLifecycle: class StudioMfeLifecycle {
    constructor(public readonly app: unknown) {}
    mount(container: unknown, bridge: unknown): void {
      superMountSpy(container, bridge);
    }
  },
}));

import lifecycle from './lifecycle';

describe('reports-mfe lifecycle', () => {
  it('binds the kit app to the lifecycle the shell mounts', () => {
    expect((lifecycle as unknown as { app: unknown }).app).toEqual({ id: 'reports-mfe-app' });
  });
});
