/**
 * Open one project's Team from outside the project — what the prototype's
 * People page did when a project mark was clicked (`openTeam`, which pushed
 * the Team tab's address). Here the shell owns the address, so the MFE says,
 * in order: this workspace, this project, the Team screen. The shell has no
 * single "open this project's screen" action; these are the three it has.
 */

import { FRONTX_SCREEN_DOMAIN, type ChildMfeBridge } from '@gears-frontx/react';
import {
  STUDIO_ACTION_CONTEXT_PUBLISH,
  STUDIO_ACTION_WORKSPACES_PUBLISH,
  openScreen,
  sendToHost,
} from '../host/hostActions';

/** The Team screen's manifest route (team-mfe, kit `project-team`). */
export const TEAM_ROUTE = '/projects/team';

export interface TeamTarget {
  project: { id: string; name: string };
  workspace: { id: string; name: string };
  /** The workspace's projects, for the switcher while the project is open. */
  siblings: readonly { id: string; name: string }[];
  organizationId: string | null;
}

export function openProjectTeam(bridge: ChildMfeBridge | null, target: TeamTarget): void {
  const { project, workspace, siblings, organizationId } = target;
  sendToHost(bridge, {
    type: STUDIO_ACTION_WORKSPACES_PUBLISH,
    target: FRONTX_SCREEN_DOMAIN,
    payload: {
      kind: 'selected',
      workspace: { ...workspace },
      ...(organizationId ? { organizationId } : {}),
    },
  });
  const listed = siblings.some((s) => s.id === project.id) ? [...siblings] : [...siblings, project];
  sendToHost(bridge, {
    type: STUDIO_ACTION_CONTEXT_PUBLISH,
    target: FRONTX_SCREEN_DOMAIN,
    payload: {
      kind: 'opened',
      project: { ...project },
      siblings: listed.map((s) => ({ id: s.id, name: s.name })),
      workspaceId: workspace.id,
    },
  });
  openScreen(bridge, TEAM_ROUTE);
}
