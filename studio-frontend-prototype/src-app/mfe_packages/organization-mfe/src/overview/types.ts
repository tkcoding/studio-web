/** The organization overview's shape (GET /studio-organizations/v1/overview), as the
 *  prototype's client had it (src/api.ts at 00828880). */

export interface OrgOverview {
  organization_id: string;
  name: string;
  period_from: string;
  period_to: string;
  previous_from: string;
  previous_to: string;
  stuck_days: number;
  growth_alert: number;
  quiet_days: number;
  costs: 'shown' | 'hidden' | 'unreadable';
  needs: OrgNeed[];
  spend: OrgSpend | null;
  delivery: { merged: number | null; window_days: number; open: number | null; median_wait_days: number | null };
  specs: { specs: number | null; failing: number | null; open_findings: number | null };
  people: {
    active: number | null;
    with_spend: number | null;
    per_person: number | null;
    idle: { person_id: string; name: string | null }[] | null;
  };
  workspaces: OrgWorkspace[];
  money: OrgMoney[] | null;
  waiting_on: OrgQueue[] | null;
  decisions: { undecided: number; candidates: number; registered: number; published: number } | null;
  /**
   * The organization's kits the answer was computed for (ADR-0070 §7): without
   * `project-git` the pull-request parts are null and its need is not listed.
   * Null when they could not be read.
   */
  kits?: string[] | null;
}

export interface OrgNeed {
  kind: 'connection' | 'spend' | 'pulls' | 'components' | 'runs';
  tone: 'danger' | 'warn';
  provider?: string | null;
  status?: string | null;
  projects: string[];
  repos?: number | null;
  current?: number | null;
  previous?: number | null;
  forecast?: number | null;
  grower?: string | null;
  pulls?: number | null;
  people?: number | null;
  components?: number | null;
  runs?: number | null;
  /** The kit whose screen answers it (`project-git`, `org-costs`, `components`); null for the shell's own. */
  kit?: string | null;
}

export interface OrgSpend {
  currency: string;
  current: number;
  previous: number;
  forecast: number;
  own_keys: number;
  attributed: number;
  unattributed: number;
  sessions: number;
  unpriced: string[];
}

export interface OrgReason {
  kind: 'refused' | 'specs_failing' | 'stuck' | 'spend_grows' | 'quiet';
  value: number | null;
}

export interface OrgProjectHealth {
  id: string;
  name: string;
  spend: number | null;
  previous: number | null;
  specs_failing: number | null;
  open_findings: number | null;
  stuck: number;
  quiet_days: number | null;
  broken: boolean;
  score: number;
  reasons: OrgReason[];
}

export interface OrgWorkspace {
  id: string;
  name: string;
  spend: number | null;
  previous: number | null;
  specs_failing: number;
  stuck: number;
  quiet_days: number | null;
  score: number;
  projects: OrgProjectHealth[];
}

export interface OrgQueue {
  person_id: string | null;
  /** Null: pull requests nobody was asked to review. */
  who: string | null;
  count: number;
  oldest_days: number;
}

export interface OrgMoney {
  group_by: CostGroup;
  include_personal: boolean;
  /** By person: `key` is the member, `unattributed`, or empty for IDE sessions. */
  rows: { key: string; label: string | null; cost: number; previous: number; unpriced: boolean }[];
}

export type CostGroup = 'person' | 'project' | 'model' | 'source' | 'payer';

