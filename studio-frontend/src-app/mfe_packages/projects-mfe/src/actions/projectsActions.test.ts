import { describe, expect, it, vi } from 'vitest';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture.ts';
import { requestOpenProject } from './projectsActions';

describe('requestOpenProject', () => {
  it('tells the shell to open the project, and opens nothing itself', async () => {
    const { mfeApp } = await import('../init');
    const { bridge, executeActionsChain } = createMfeBridgeFixture({
      domainId: 'screen',
      instanceId: 'inst',
    });

    requestOpenProject({ id: 'proj', name: 'proj' }, [{ id: 'proj', name: 'proj' }], bridge, 'ws-1');

    // The shell owns which project is open. A row asks; it does not decide —
    // and it names the workspace it read the project in, or the shell cannot
    // tell a late announcement from a current one.
    await vi.waitFor(() => {
      const payloads = executeActionsChain.mock.calls.map(([chain]) => chain.action.payload);
      expect(payloads).toContainEqual(
        expect.objectContaining({
          kind: 'opened',
          project: { id: 'proj', name: 'proj' },
          workspaceId: 'ws-1',
        })
      );
    });

    // Local state stays put until the shell publishes the project back. It used
    // to be written here too, and that second writer is what made the shell's
    // echo look like "nothing changed" — the tabs then marked no section.
    const state = mfeApp.store.getState() as Record<string, { projectId: string | null }>;
    expect(state['projects/nav'].projectId).toBeNull();
  });
});
