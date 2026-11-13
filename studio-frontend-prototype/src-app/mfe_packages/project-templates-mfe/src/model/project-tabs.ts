/**
 * What `project-types.ts` imported from the rest of the prototype
 * (00828880:studio-frontend-prototype/src), carried over unchanged so that
 * module moves as it was: `ProjTab` (project-overview.tsx), `RepoRoad`
 * (project-form.ts), `ProjectKind` (api.ts), `MOVED_PROJECT_TABS` and
 * `currentProjectTab` (product-sections.ts), and the project's tabs
 * (`PROJECT_TABS` in App.tsx), ids and labels only.
 *
 * `PROJECT_TABS` is the prototype's list taken as data. In this portal a
 * project's tabs are the screens registered on the project level (the shell's
 * and the installed kits'); a template should offer those once the shell
 * hands that list to a kit. Until then the template editor offers these ids,
 * which are the ones the prototype stored and still reads (docs/parity.md).
 */

export type ProjTab =
  | 'overview'
  | 'issues'
  | 'specs'
  | 'model'
  | 'components'
  | 'parts'
  | 'releases'
  | 'tests'
  | 'kits'
  | 'artifacts'
  | 'sources'
  | 'connections'
  | 'activity'
  | 'people'
  /** A tab the Studio domain model adds (level-tabs.ts). */
  | `type:${string}`;

/** Where the project's code starts: a repository created now, one attached
 *  now, or none yet (Sources adds them later). */
export type RepoRoad = 'new' | 'existing' | 'none';

export type ProjectKind = 'new_gears' | 'product' | 'existing';

/** Project tabs that moved, by their old id: Frontend became a section of
 *  Product, Builds and Deploys became Releases (ADR-0056 §4), and the
 *  project's Connections are managed from Sources, where they are used. */
export const MOVED_PROJECT_TABS: Readonly<Record<string, { tab: 'components' | 'releases' | 'sources'; section?: string }>> = {
  frontend: { tab: 'components', section: 'frontend' },
  builds: { tab: 'releases' },
  deploys: { tab: 'releases' },
  connections: { tab: 'sources' },
};

/** The tab an id names now: a moved one's new tab, any other unchanged. For
 *  every id kept somewhere -- a stored place, a pin, a project type. */
export function currentProjectTab(id: string): string {
  return MOVED_PROJECT_TABS[id]?.tab ?? id;
}

/** The prototype's project tabs, in its tab bar's order. The label is the
 *  English fallback; the screen shows its own translation (`tab_<id>`). */
export const PROJECT_TABS: readonly { id: ProjTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'issues', label: 'Issues' },
  { id: 'specs', label: 'Specs' },
  { id: 'model', label: 'Project domain model' },
  { id: 'components', label: 'Product' },
  { id: 'parts', label: 'Components' },
  { id: 'releases', label: 'Releases' },
  { id: 'tests', label: 'Tests' },
  { id: 'kits', label: 'Kits' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'sources', label: 'Sources' },
  { id: 'activity', label: 'Activity' },
  { id: 'people', label: 'Team' },
];
