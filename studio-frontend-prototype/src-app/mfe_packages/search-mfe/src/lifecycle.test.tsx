import { describe, expect, it, vi } from 'vitest';

vi.mock('./init', () => ({ mfeApp: { id: 'search-mfe-app' } }));
vi.mock('./screens/search/SearchScreen', () => ({ SearchScreen: () => null }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  StudioMfeLifecycle: class StudioMfeLifecycle {
    constructor(public readonly app: unknown) {}
  },
}));

import lifecycle from './lifecycle';

describe('search-mfe lifecycle', () => {
  it('binds the search app to the lifecycle the shell mounts', () => {
    expect((lifecycle as unknown as { app: unknown }).app).toEqual({ id: 'search-mfe-app' });
  });
});
