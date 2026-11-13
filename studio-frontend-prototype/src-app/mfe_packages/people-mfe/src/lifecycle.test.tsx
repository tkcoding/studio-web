import { describe, expect, it, vi } from 'vitest';

vi.mock('./init', () => ({ mfeApp: { id: 'people-mfe-app' } }));
vi.mock('./screens/people/PeopleScreen', () => ({ PeopleScreen: () => null }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  StudioMfeLifecycle: class StudioMfeLifecycle {
    constructor(public readonly app: unknown) {}
  },
}));

import lifecycle from './lifecycle';

describe('people-mfe lifecycle', () => {
  it('binds the People app to the lifecycle the shell mounts', () => {
    expect((lifecycle as unknown as { app: unknown }).app).toEqual({ id: 'people-mfe-app' });
  });
});
