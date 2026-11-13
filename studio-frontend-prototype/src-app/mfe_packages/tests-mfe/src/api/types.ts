/**
 * The shapes the Tests kit reads, as the prototype's client had them
 * (studio-frontend-prototype/src/api.ts at 00828880), trimmed to the fields
 * this kit uses.
 */

export interface CiJob {
  name: string;
  status: string | null;
  conclusion: string | null;
  /** The first step that failed, when one did. */
  failed_step: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  url: string | null;
}

/** One CI run as the sync kept it, with its jobs once a sync read them. */
export interface CiRun {
  id: string;
  /** The repository node it ran in. */
  repo: string | null;
  workflow: string;
  workflow_path: string | null;
  title: string | null;
  event: string | null;
  branch: string | null;
  sha: string;
  status: string | null;
  conclusion: string | null;
  url: string | null;
  number: number | null;
  created_at: string | null;
  updated_at: string | null;
  jobs?: CiJob[];
}

export interface CiRunList {
  items: CiRun[];
  total: number;
  /** The newest completed run on a mainline (else the newest completed run). */
  latest_completed: string | null;
}

export interface PullPerson {
  login: string;
  display_name?: string | null;
}

/** One open pull request and who it is waiting on. */
export interface OpenPullRequest {
  id: string;
  /** `owner/name`. */
  repo: string | null;
  number: number;
  title: string;
  url: string | null;
  /** The branch it would merge: what its CI runs ran on. */
  source_branch?: string | null;
  waiting_on: PullPerson[];
  days_open: number | null;
}

/** One artifact node; a repository's carries its path and what its CI read said. */
export interface ArtifactNode {
  type_id: string;
  instance_id: string;
  value: Record<string, unknown>;
}

export interface ArtifactNodePage {
  nodes: ArtifactNode[];
}

export interface PullRequestFileCheck {
  path: string;
  conforms: boolean;
  issues: string[];
}

export interface PullRequestCheck {
  repo: string;
  number: number;
  title: string;
  url?: string | null;
  head: string;
  state: 'success' | 'failure';
  description: string;
  files: PullRequestFileCheck[];
}

export interface PullRequestChecks {
  items: PullRequestCheck[];
  total: number;
  pulls: number;
  reached: boolean;
}

export interface Capability {
  key: string;
  label: string;
  /** Empty means "match the key itself". */
  terms: string[];
  /** What the Gearbox engine can report a gear as providing. */
  contracts?: string[];
  nonfunctional?: boolean;
}

export interface DeclaredCapability {
  key: string;
}

export interface Conformance {
  repo: string;
  items: {
    capability: string;
    /** The server also answers `nonfunctional`. */
    status: 'implemented' | 'missing' | 'nonfunctional';
  }[];
  total: number;
}
