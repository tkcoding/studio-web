// Ported unchanged from the prototype (src/registry.ts and src/org-gear-repository.ts at 00828880): the four
// functions Project › Components uses; the rest of those modules is the organization's registry's (components-mfe).
import type { RegistryEntry } from '../../api/types';

/** Why a candidate looks like a gear, one line per signal, heaviest first:
 *  "own REST surface: rest.rs (+3)". */
export function evidenceLines(e: Pick<RegistryEntry, 'evidence'>): string[] {
  return (e.evidence ?? [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((v) => `${v.detail} (+${v.weight})`);
}

/** The project ids a candidate was detected in, so Declare it can name one
 *  when it was found in several. */
export function detectedProjects(e: Pick<RegistryEntry, 'occurrences'>): string[] {
  const out: string[] = [];
  for (const o of e.occurrences) {
    if (o.declared_in === 'detected' && o.project_id && !out.includes(o.project_id)) out.push(o.project_id);
  }
  return out;
}

/** What a refused Declare it says to a person: a 403 is the administrator
 *  rule, a 503 a deployment without studio-product. */
export function declareRefusal(status: number | undefined, fallback: string): string {
  if (status === 403) return `Only an organization administrator can declare a gear (${fallback}).`;
  if (status === 503) return `Declaring a gear is not available in this deployment (${fallback}).`;
  return fallback;
}

/** Where a scaffold writes, as a person reads it: the sentence the dialog
 *  states before anything is pushed. `target` is the server's answer
 *  (`project`, `organization`, `sources`), `repo` the repository. */
export function scaffoldTargetLine(target: string | null | undefined, repo: string | null | undefined): string {
  if (!repo) {
    return "Nowhere to write yet: connect a gear repository to this project, or set the organization's on its Components page.";
  }
  switch (target) {
    case 'organization':
      return `Into the organization's gear repository ${repo}.`;
    case 'project':
      return `Into this project's gear repository ${repo}.`;
    case 'sources':
      return `Into this project's repository ${repo} (from its sources): it has no gear repository, and the organization has none set.`;
    default:
      return `Into ${repo}.`;
  }
}
