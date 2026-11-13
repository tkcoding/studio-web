import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { fetchPhases } = vi.hoisted(() => ({ fetchPhases: vi.fn() }));
vi.mock('@gears-frontx/react', () => ({
  apiRegistry: { getService: () => ({ phases: ({ organizationId }: { organizationId: string }) => ({ fetch: () => fetchPhases(organizationId) }) }) },
}));
vi.mock('../api/ProjectStatusApiService', () => ({ ProjectPhaseApiService: class {} }));

import { useProjectPhases } from './useProjectPhases';

it('clears the previous organization immediately and ignores its late response', async () => {
  let finishOld!: (value: { installed: boolean; items: { project_id: string; phase: string }[] }) => void;
  fetchPhases.mockImplementation((org: string) => org === 'old'
    ? new Promise((resolve) => { finishOld = resolve; })
    : Promise.resolve({ installed: true, items: [{ project_id: 'new-project', phase: 'build' }] }));
  const { result, rerender } = renderHook(({ org }) => useProjectPhases(org), { initialProps: { org: 'old' } });
  rerender({ org: 'new' });
  expect(result.current).toEqual({});
  await waitFor(() => expect(result.current).toEqual({ 'new-project': 'build' }));
  await act(async () => finishOld({ installed: true, items: [{ project_id: 'old-project', phase: 'idea' }] }));
  expect(result.current).toEqual({ 'new-project': 'build' });
  rerender({ org: '' });
  expect(result.current).toEqual({});
});
