import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/** Only source-code drivers reach the picker (algo `...-project-create-repos`, `inst-1`). */

const { providers, connections } = vi.hoisted(() => ({
  providers: {
    items: [
      { provider: 'github', display_name: 'GitHub', category: 'source_code' },
      { provider: 'openai', display_name: 'OpenAI', category: 'model' },
    ],
  },
  connections: {
    items: [
      { id: 'c-github', provider: 'github', label: 'acme' },
      { id: 'c-openai', provider: 'openai', label: 'llm' },
    ],
  },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({ providers: 'providers', connections: () => 'connections' }),
  },
  useApiQuery: (read: string) => ({
    data: read === 'providers' ? providers : connections,
    isLoading: false,
    isError: false,
  }),
}));

import { useSourceConnections } from './useConnections';

describe('the source connections', () => {
  it('leave out a provider that is not a source-code driver, and its connections', () => {
    const { result } = renderHook(() => useSourceConnections('org-1'));

    expect(result.current.providers.map((entry) => entry.provider)).toEqual(['github']);
    expect(result.current.connections.map((entry) => entry.id)).toEqual(['c-github']);
  });

  it('are given by id as well, for a sync request', () => {
    const { result } = renderHook(() => useSourceConnections('org-1'));

    expect([...result.current.byId.keys()]).toEqual(['c-github']);
    expect(result.current.byId.get('c-github')?.label).toBe('acme');
  });

  it('keep the same list and map while the answers stay the same', () => {
    const { result, rerender } = renderHook(() => useSourceConnections('org-1'));
    const { connections: list, byId } = result.current;

    rerender();

    expect(result.current.connections).toBe(list);
    expect(result.current.byId).toBe(byId);
  });
});
