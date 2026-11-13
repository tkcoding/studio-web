/**
 * The workspaces list's rules, apart from the markup: which rows a search and
 * the managed filter keep, and what each row says under its name. The
 * prototype's `ProjectsPortfolio` (`projects.tsx`): the health numbers are the
 * organization overview's (`GET /studio-organizations/v1/overview`), joined to
 * the account system's workspaces by id.
 */

import type { Tenant } from '@constructor-studio/mfe-shared';
import { workspaceDescription, workspaceLine } from '../../overview/model';
import type { OrgOverview, OrgWorkspace } from '../../overview/types';

/** The prototype's chips: every workspace, the self-managed ones, the organization's. */
export type ManagedFilter = 'all' | 'self' | 'org';

export const MANAGED_FILTERS: readonly ManagedFilter[] = ['all', 'self', 'org'];

export function matchesManaged(row: Pick<Tenant, 'self_managed'>, filter: ManagedFilter): boolean {
  if (filter === 'self') return !!row.self_managed;
  if (filter === 'org') return !row.self_managed;
  return true;
}

/** The rows a search and the managed filter keep, by name as the prototype sorted them. */
export function visibleWorkspaces(all: readonly Tenant[], query: string, managed: ManagedFilter): Tenant[] {
  const needle = query.trim().toLowerCase();
  return all
    .filter((row) => !needle || row.name.toLowerCase().includes(needle))
    .filter((row) => matchesManaged(row, managed))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A workspace's health in the overview, or undefined when the overview has none for it. */
export function healthOf(overview: OrgOverview | null | undefined, id: string): OrgWorkspace | undefined {
  return overview?.workspaces.find((w) => w.id === id);
}

/**
 * The line under a workspace's name: its worst project and why when one is in
 * trouble; otherwise its projects by name and whether it manages itself. The
 * names are the overview's; without it only a workspace known to be empty can
 * say so, and the rest say only whether they are self-managed.
 */
export function workspaceSummary(row: Tenant, health: OrgWorkspace | undefined, stuckDays: number): string {
  if (health && health.projects.some((p) => p.reasons.length > 0)) return workspaceLine(health, stuckDays);
  const names = health ? health.projects.map((p) => p.name) : row.child_count === 0 ? [] : undefined;
  return workspaceDescription(names, !!row.self_managed);
}
