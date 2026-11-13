// One person's inbox: everything whose next move is theirs, across projects.
//
// The items are not stored anywhere. Each is read from its fact every time —
// a review request that still waits for the person's verdict
// (studio-documents `review-requests?waiting_on=me`), a pull request whose
// next step is theirs (artifact-ingest `open-pull-requests?waiting_on=me`) —
// so an item leaves by itself when the fact changes. What the person keeps is
// a mark: done, or snoozed until a time (studio-user `me/inbox-marks`).

import type { OpenPullRequest } from "./api";
import type { ReviewRequest } from "./review-requests";

export type InboxItem =
  | { kind: "review"; key: string; workspace: string; due: string | null; overdue: boolean; review: ReviewRequest }
  | { kind: "pull"; key: string; workspace: string; due: null; overdue: boolean; pull: OpenPullRequest };

export interface InboxMark {
  item_key: string;
  state: "done" | "snoozed" | "open";
  until?: string | null;
  updated_at: string;
}

/** A review request is one item for as long as it lives: a new version is a
 *  new request, so a new item. */
export function reviewKey(r: ReviewRequest): string {
  return `review:${r.id}`;
}

/** A pull request is keyed with when it last changed: marking it done hides
 *  it until somebody moves it again. */
export function pullKey(p: OpenPullRequest): string {
  return `pr:${p.id}@${p.updated_at ?? ""}`;
}

/** Everything waiting, both kinds, with the marks applied: overdue reviews
 *  first, then by due date, then reviews before pull requests, then the
 *  pull requests in the order their own list gave them. */
export function inboxItems(
  reviews: { workspace: string; items: ReviewRequest[] }[],
  pulls: { workspace: string; items: OpenPullRequest[] }[],
  marks: InboxMark[],
  now: Date,
): { open: InboxItem[]; hidden: number; hiddenItems: InboxItem[] } {
  const marked = new Map(marks.map((m) => [m.item_key, m]));
  const hides = (key: string) => {
    const m = marked.get(key);
    if (!m) return false;
    if (m.state === "done") return true;
    return m.state === "snoozed" && !!m.until && new Date(m.until) > now;
  };
  const all: InboxItem[] = [
    ...reviews.flatMap(({ workspace, items }) =>
      items.map(
        (review): InboxItem => ({
          kind: "review",
          key: reviewKey(review),
          workspace,
          due: review.due_at ?? null,
          overdue: review.overdue,
          review,
        }),
      ),
    ),
    ...pulls.flatMap(({ workspace, items }) =>
      items.map(
        (pull): InboxItem => ({ kind: "pull", key: pullKey(pull), workspace, due: null, overdue: false, pull }),
      ),
    ),
  ];
  const open = all.filter((i) => !hides(i.key));
  const order = (i: InboxItem) => [i.overdue ? 0 : 1, i.due ? Date.parse(i.due) : Number.MAX_SAFE_INTEGER, i.kind === "review" ? 0 : 1];
  const indexed = open.map((item, n) => ({ item, n }));
  indexed.sort((a, b) => {
    const x = order(a.item);
    const y = order(b.item);
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k];
    return a.n - b.n;
  });
  // What the marks hide, in the list's own order: "Bring them back" shows
  // these, and "Unmark all" clears exactly these marks -- never one for an
  // item no longer on any list (#744).
  const hiddenItems = all.filter((i) => hides(i.key));
  return { open: indexed.map((x) => x.item), hidden: hiddenItems.length, hiddenItems };
}

/** When a snooze of `days` from `now` ends, as the API takes it. */
export function snoozeUntil(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** Whether a studio-events frame concerns this person's inbox. */
export function concernsMe(
  frame: { subject_type?: string; payload?: unknown },
  me: string | null,
): boolean {
  if (frame.subject_type !== "review_request" || !me) return false;
  const p = (frame.payload ?? {}) as { reviewers?: unknown; requested_by?: unknown };
  const reviewers = Array.isArray(p.reviewers) ? (p.reviewers as unknown[]) : [];
  return reviewers.includes(me) || p.requested_by === me;
}
