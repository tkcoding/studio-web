/**
 * The person's Inbox as the server answers it (`GET /studio-user/v1/me/inbox`,
 * studio-backend `user_profile/inbox.rs`). The prototype computed this list in
 * the browser (`waiting-on-me.ts` `inboxItems`); the server now reads every
 * source as the caller, applies the person's marks and orders it.
 */

import type { OpenPullRequest } from './api';

/** The shell's own sources, or a kit's (`kit:<slug>/<id>`, ADR-0068 §6), rendered by its `title`. */
export type InboxSource = 'review-requests' | 'pull-requests' | (string & {});

/** The part of a review request (studio-documents) a row shows. */
export interface ReviewRecord {
  id: string;
  title: string;
  requested_by?: string;
  requested_by_name?: string | null;
  due_at?: string | null;
  overdue?: boolean;
}

export interface InboxItem {
  /** What its mark is kept under: `review:<id>` or `pr:<id>@<updated_at>`. */
  key: string;
  source: InboxSource;
  workspace_id: string;
  workspace_name: string;
  title: string;
  url: string | null;
  /** RFC 3339. */
  due_at: string | null;
  overdue: boolean;
  /** The source's own record: a review request, an open pull request, a kit's row. */
  record: ReviewRecord | OpenPullRequest | Record<string, unknown>;
  /**
   * The kit a source comes from: a kit's (`kit:<slug>/<id>`), project-specs for
   * `review-requests`, project-git for `pull-requests` (ADR-0070 §7; without the
   * kit the server reads no such items); absent for the shell's own (`failed-runs`).
   */
  kit?: InboxKit | null;
}

/** The kit an Inbox item comes from (ADR-0068 §6). */
export interface InboxKit {
  slug: string;
  name: string;
  version: string;
}

export type InboxView = 'open' | 'hidden';

export interface Inbox {
  items: InboxItem[];
  total: number;
  /** How many the other view holds: hidden ones on `open`, open ones on `hidden`. */
  other: number;
  /** The sources that could not be read, each with why. */
  unread: string[];
}

export type InboxMarkState = 'done' | 'snoozed' | 'open';

export interface InboxMark {
  item_key: string;
  state: InboxMarkState;
  until?: string | null;
  updated_at: string;
}
