import { describe, expect, it, vi } from 'vitest';

vi.mock('./init', () => ({ mfeApp: { id: 'infrastructure-mfe-app' } }));
vi.mock('./screens/research/ResearchScreen', () => ({ ResearchScreen: () => null }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  StudioMfeLifecycle: class StudioMfeLifecycle {
    constructor(public readonly app: unknown) {}
  },
}));

import lifecycle from './researchLifecycle';

describe('infrastructure-mfe research lifecycle', () => {
  it('binds the same app as the Infrastructure entry, in a lifecycle of its own', () => {
    expect((lifecycle as unknown as { app: unknown }).app).toEqual({ id: 'infrastructure-mfe-app' });
  });
});
