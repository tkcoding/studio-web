/**
 * A project's status as the server answers it (`ProjectStatusDto`,
 * studio-backend `organizations/rest.rs`), and what the Overview needs to draw
 * it in this portal: where each of the prototype's project tabs lives here, and
 * the prototype's tones as Badge variants. The rules — the verdict, the
 * signals, the path — are the server's.
 */

export type Verdict = 'blocked' | 'at_risk' | 'on_track';
export type SignalLevel = 'blocked' | 'risk' | 'info';
export type StepState = 'done' | 'current' | 'todo' | 'unknown';

export interface ProjectSignal {
  /** `refused`, `product`, `build`, `deploy`, `findings`, `specs`, `stuck`, `nobody`, `threads`, `quiet`. */
  key: string;
  level: SignalLevel;
  phrase: string;
  detail?: string | null;
  /** `target`: a project tab (`sources`, `specs`, `model`, `components`, `releases`, `activity`), `pulls` or `ide`. */
  action: { label: string; target: string };
  /**
   * The kit the signal is read for and whose tab its action opens
   * (`project-git`, `project-specs`, `project-issues`, `product-releases`,
   * `project-activity`); null for the shell's own. The server leaves out a
   * signal of a kit not installed for the project (ADR-0070 §7).
   */
  kit?: string | null;
}

export interface ProjectPathStep {
  /** `repos`, `types`, `model`, `findings`, `kind`, `product` or `build`. */
  step: string;
  title: string;
  state: StepState;
  /** As the strip draws it: `failed`, `warn`, `later` (unknown), else the state. */
  flow: string;
  status: string;
  tab: string;
  action: string;
  /** The kit whose tab that is; null for Sources. A step of a kit not installed is not on the path. */
  kit?: string | null;
}

export interface ProjectStatus {
  project_id: string;
  verdict: Verdict;
  label: string;
  reason: string;
  more: number;
  signals: ProjectSignal[];
  path: ProjectPathStep[];
  next?: string | null;
  unread: string[];
  /** The kits installed for the project the status was computed for; null when they could not be read. */
  kits?: string[] | null;
}

/**
 * Where a prototype project tab is in this portal, by route. A tab with no
 * screen here yet has none, and its rows offer no button rather than a dead
 * one: the in-place pull request list (`pulls`) is not ported. The `model`
 * step is the Project domain model tab (kit `project-domain-model`, what the
 * project's documents say; not the Studio domain model). Findings are
 * decided on the Issues kit's screen, so the `findings` step and signal open
 * it.
 */
const TAB_ROUTE: Record<string, string> = {
  sources: '/projects/sources',
  specs: '/projects/specs',
  model: '/domain-model',
  components: '/product',
  releases: '/releases',
  activity: '/projects/activity',
  ide: '/space',
};

const KEY_ROUTE: Record<string, string> = {
  findings: '/issues',
};

/** The route an action opens, or null when the screen is not in this portal. */
export function routeFor(target: string, key?: string): string | null {
  return (key && KEY_ROUTE[key]) || TAB_ROUTE[target] || null;
}

export type BadgeVariant = 'danger' | 'warning' | 'success' | 'info' | 'secondary';

export const VERDICT_VARIANT: Record<Verdict, BadgeVariant> = {
  blocked: 'danger',
  at_risk: 'warning',
  on_track: 'success',
};

export const LEVEL_TONE: Record<SignalLevel, 'danger' | 'warn' | 'info'> = {
  blocked: 'danger',
  risk: 'warn',
  info: 'info',
};

/** How many steps are done (`project-path.ts` `pathProgress`). */
export function pathProgress(steps: readonly ProjectPathStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.state === 'done').length, total: steps.length };
}

/** The step the server names as next, or null when the path is done or unknown. */
export function nextStep(status: ProjectStatus): ProjectPathStep | null {
  return status.next ? (status.path.find((s) => s.step === status.next) ?? null) : null;
}
