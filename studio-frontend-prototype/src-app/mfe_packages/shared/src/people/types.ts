/**
 * What the People and Team screens read, as the gears answer it: members and
 * colleagues (studio-user), an organization's access config (account
 * management's tenant metadata), and the sources that say where somebody
 * works (studio-artifact-ingest, studio-session, studio-presence,
 * studio-insight). Ported from the prototype's `api.ts` (ADR-0069).
 */

export type MembershipRole = 'owner' | 'admin' | 'member';

/** How the organization describes a member. */
export interface MemberDirectory {
  affiliation?: string | null;
  department?: string | null;
  title?: string | null;
  /** The member they report to, by person id. */
  reports_to?: string | null;
}

/** One member, from `GET /studio-user/v1/organizations/{org_id}/members` (`people.view`). */
export interface OrgMember {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  last_seen_at_epoch_ms?: number | null;
  directory?: MemberDirectory | null;
  role: MembershipRole | string;
  status: 'active' | 'suspended' | string;
  source?: string;
  created_at_epoch_ms?: number;
  updated_at_epoch_ms?: number;
}

/** One person the caller shares an organization with (`GET /studio-user/v1/me/colleagues`). No address, by design. */
export interface Colleague {
  org_id: string;
  user_id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  role: MembershipRole | string;
  directory?: MemberDirectory | null;
  last_seen_at_epoch_ms?: number | null;
}

export interface PersonLogin {
  provider: string;
  subject: string;
  verified?: boolean;
}

/** An account a person is known by elsewhere. */
export interface PersonAlias {
  kind: string;
  external_id: string;
  /** suggested | claimed | confirmed */
  confidence: string;
  attributes?: boolean;
  added_at_epoch_ms?: number;
}

/** `GET /studio-user/v1/organizations/{org_id}/members/{user_id}/identities`. */
export interface MemberIdentities {
  user_id: string;
  logins: PersonLogin[];
  aliases: PersonAlias[];
}

export interface OrgInvitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
}

export type ActivityEventKind = 'check' | 'comment';

/** One thing that happened to a project (`GET /studio-artifact-ingest/v1/activity`). */
export interface ActivityEvent {
  id: string;
  kind: ActivityEventKind | string;
  event: string;
  subject: string;
  by: string;
  recorded?: string | null;
  severity?: string | null;
}

export type PullWaiting = 'review' | 'author' | 'merge' | 'draft' | 'nobody';

/** An account a pull request names, read as a person where it can be. */
export interface PullPerson {
  login: string;
  /** The organization member the account is confirmed as, or null. */
  user_id: string | null;
  display_name?: string | null;
  in_organization?: boolean | null;
}

export interface PullReviewer {
  person: PullPerson;
  state: string;
}

/** An open pull request the project's sync holds (`GET /studio-artifact-ingest/v1/open-pull-requests`). */
export interface OpenPullRequest {
  id: string;
  repo: string | null;
  number: number;
  title: string;
  url: string | null;
  author: PullPerson | null;
  waiting: PullWaiting | string;
  waiting_on: PullPerson[];
  reviewers: PullReviewer[];
  created_at: string | null;
  updated_at: string | null;
  days_open: number | null;
  provider?: string | null;
  project_id?: string | null;
  source_branch?: string | null;
  waiting_on_teams?: string[];
  reason?: string;
  review_decision?: string | null;
  assignees?: PullPerson[];
  draft?: boolean;
  open_threads?: number | null;
  days_since_update?: number | null;
}

/** A desktop open on a project (`GET /studio-session/v1/desktop-sessions`). */
export interface DesktopSession {
  id: string;
  /** Token subject of whoever has it open. */
  member_id: string;
  last_seen_epoch_secs: number;
  workspace_id?: string;
  device_id?: string;
  device_name?: string | null;
  started_at_epoch_secs?: number;
  expires_at_epoch_secs?: number;
  heartbeat_secs?: number;
}

/** Who is online and where (`GET /studio-presence/v1/online`). */
export interface PresenceEntry {
  user_id: string;
  display_name?: string | null;
  last_seen_ms: number;
  tenant_id?: string;
  place?: string;
  detail?: string | null;
  since_ms?: number;
}

/** `POST /studio-insight/v1/query`. */
export interface InsightQueryResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}
