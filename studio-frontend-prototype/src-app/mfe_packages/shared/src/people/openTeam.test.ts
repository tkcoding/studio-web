import { describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  STUDIO_ACTION_CONTEXT_PUBLISH,
  STUDIO_ACTION_SCREEN_OPEN,
  STUDIO_ACTION_WORKSPACES_PUBLISH,
} from '../host/hostActions';
import { openProjectTeam, TEAM_ROUTE } from './openTeam';

describe('openProjectTeam', () => {
  it('names the workspace, then the project, then the Team screen', () => {
    const executeActionsChain = vi.fn();
    const bridge = { executeActionsChain } as unknown as ChildMfeBridge;
    openProjectTeam(bridge, {
      project: { id: 'p1', name: 'Alpha' },
      workspace: { id: 'w1', name: 'Core' },
      siblings: [{ id: 'p2', name: 'Beta' }],
      organizationId: 'o1',
    });
    const actions = executeActionsChain.mock.calls.map(([chain]) => chain.action);
    expect(actions.map((a) => a.type)).toEqual([
      STUDIO_ACTION_WORKSPACES_PUBLISH,
      STUDIO_ACTION_CONTEXT_PUBLISH,
      STUDIO_ACTION_SCREEN_OPEN,
    ]);
    expect(actions[0].payload).toEqual({ kind: 'selected', workspace: { id: 'w1', name: 'Core' }, organizationId: 'o1' });
    expect(actions[1].payload).toEqual({
      kind: 'opened',
      project: { id: 'p1', name: 'Alpha' },
      siblings: [
        { id: 'p2', name: 'Beta' },
        { id: 'p1', name: 'Alpha' },
      ],
      workspaceId: 'w1',
    });
    expect(actions[2].payload).toEqual({ route: TEAM_ROUTE });
  });
});
