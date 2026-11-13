/**
 * The Constructor Research kit's reading of the organization
 * (docs/design/studio-kits.md §3.13, ADR-0049): whether the kit applies, the
 * member's own sign-in to Constructor Research, the organization's Research
 * environments, and what each project runs in them.
 */

import type { Connection, DeployEnvironment, Deployment, InstalledKits } from '../api/types';
import { whatRunsWhere } from './releases';

/** The kit's slug in studio-kits' library. */
export const RESEARCH_KIT = 'constructor-research';

/** Whether the organization has the kit, from `GET /installed-kits`. */
export function researchKitApplies(installed: InstalledKits | null | undefined): boolean {
  return !!installed?.effective?.some((k) => k.kit_slug === RESEARCH_KIT);
}

/** The member's own sign-in to Constructor Research (ADR-0049 §1, §5): a
 *  `research` connection they made, kept personal. Every build and deploy to
 *  Research runs with it; nobody runs on another member's. */
export function ownResearchSignIn(connections: readonly Connection[]): Connection | null {
  return connections.find((c) => c.provider === 'research' && (c.mine === true || c.scope === 'personal')) ?? null;
}

/** The organization's environments that are Research projects, by name. */
export function researchEnvironments(environments: readonly DeployEnvironment[]): DeployEnvironment[] {
  return environments.filter((e) => e.kind === 'research').sort((a, b) => a.name.localeCompare(b.name));
}

/** One project's application in one Research environment: the deploy that
 *  runs there now (null when nothing does) and the newest deploy. */
export interface ResearchApplication {
  projectId: string;
  projectName: string;
  runs: Deployment | null;
  latest: Deployment;
}

/** What runs in each Research environment, by environment id, a project per
 *  application (`{project}-{environment}`, ADR-0049 §2). Previews are left
 *  out: Research takes none. */
export function researchApplications(
  environments: readonly DeployEnvironment[],
  deployments: readonly Deployment[]
): Map<string, ResearchApplication[]> {
  const ids = new Set(environments.filter((e) => e.kind === 'research').map((e) => e.id));
  const out = new Map<string, ResearchApplication[]>();
  for (const id of ids) out.set(id, []);
  for (const row of whatRunsWhere(deployments.filter((d) => ids.has(d.environment_id)))) {
    for (const [environmentId, cell] of row.cells) {
      out.get(environmentId)?.push({ projectId: row.projectId, projectName: row.projectName, ...cell });
    }
  }
  return out;
}

/** Where the member stands, as the steps of the kit's page say it. */
export type ResearchStep = 'sign_in' | 'connect_project' | 'deploy' | 'running';

/** The next thing to do: sign in, connect a Research project (an
 *  administrator), deploy a project from its Releases, or nothing left. */
export function nextResearchStep(
  signIn: Connection | null,
  environments: readonly DeployEnvironment[],
  applications: ReadonlyMap<string, readonly ResearchApplication[]>
): ResearchStep {
  if (!signIn) return 'sign_in';
  if (!environments.some((e) => e.kind === 'research')) return 'connect_project';
  for (const apps of applications.values()) if (apps.some((a) => a.runs)) return 'running';
  return 'deploy';
}
