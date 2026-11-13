// The prototype's pull request types (00828880 studio-frontend-prototype/src/api.ts), unchanged, for
// pull-request-waits.ts, which imports them from "./api". An Inbox item's `record` is one of these
// when its source is `pull-requests`.

export type PullWaiting = "review" | "author" | "merge" | "draft" | "nobody";

/** An account a pull request names, read as a person where it can be. */
export interface PullPerson {
  login: string;
  /** The organization member the account is confirmed as, or null. */
  user_id: string | null;
  display_name: string | null;
  /** `false` = no member of the organization has confirmed this account;
   *  `null` = the member directory could not be asked. */
  in_organization: boolean | null;
}

export interface PullReviewer {
  person: PullPerson;
  /** `pending`, `approved`, `changes_requested` or `commented`. */
  state: string;
}

export interface OpenPullRequest {
  id: string;
  /** `owner/name`. */
  repo: string | null;
  provider: string | null;
  /** The project it was synced for. */
  project_id: string | null;
  number: number;
  title: string;
  url: string | null;
  /** The branch it would merge: what its CI runs ran on. */
  source_branch?: string | null;
  author: PullPerson | null;
  waiting: PullWaiting;
  waiting_on: PullPerson[];
  waiting_on_teams: string[];
  reason: string;
  review_decision: string | null;
  reviewers: PullReviewer[];
  assignees: PullPerson[];
  draft: boolean;
  open_threads: number | null;
  created_at: string | null;
  updated_at: string | null;
  days_open: number | null;
  days_since_update: number | null;
}
