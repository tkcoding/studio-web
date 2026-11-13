// Review remarks on a document, read live from the pull requests that
// changed it, the decisions recorded on its requirements, and a brief for its
// reviewers (studio-documents `/remarks`, `/decisions`, `/review-brief`).

export interface RemarkComment {
  author?: string | null;
  body: string;
  url?: string | null;
  created_at?: string | null;
}

export interface Remark {
  thread_id: string;
  repo: string;
  pull_number: number;
  pull_title: string;
  pull_url?: string | null;
  pull_state: "OPEN" | "CLOSED" | "MERGED" | string;
  resolved: boolean;
  outdated: boolean;
  left_open: boolean;
  line?: number | null;
  comments: RemarkComment[];
  requirements: string[];
}

export interface Remarks {
  items: Remark[];
  total: number;
  left_open: number;
  reached: boolean;
}

export interface Decision {
  id: string;
  statement: string;
  requirements: string[];
  source_url?: string | null;
  source_kind: "review_thread" | "meeting" | "chat" | "other";
  path?: string | null;
  decided_by: string;
  decided_by_name?: string | null;
  decided_at: string;
}

export interface BriefChange {
  id: string;
  kind: "added" | "removed" | "changed";
  before?: string | null;
  after?: string | null;
  meaning: boolean;
  why: string;
}

export interface ReviewBrief {
  path: string;
  problem: string;
  roles: string[];
  scope: string;
  out_of_scope: string[];
  assumptions: string[];
  open_decisions: string[];
  base_ref?: string | null;
  changes: BriefChange[];
  provider: string;
  model: string;
}

/** Where a remark stands, in a word. */
export function remarkState(r: Remark): { label: string; tone: "late" | "wait" | "ok" } {
  if (r.left_open) return { label: `Left open after ${r.pull_state === "MERGED" ? "merge" : "close"}`, tone: "late" };
  if (!r.resolved) return { label: "Open", tone: "wait" };
  return { label: "Resolved", tone: "ok" };
}

/** A decision drafted from a thread: its last comment, the identifiers the
 *  thread names, and the thread as its source. */
export function decisionFromRemark(r: Remark, path: string) {
  const last = r.comments[r.comments.length - 1];
  return {
    statement: last?.body.trim() ?? "",
    requirements: r.requirements,
    source_url: last?.url ?? r.pull_url ?? null,
    source_kind: "review_thread" as const,
    path,
  };
}

/** Changes of meaning first, then rewording, each in the brief's order. */
export function orderChanges(changes: BriefChange[]): BriefChange[] {
  return [...changes.filter((c) => c.meaning), ...changes.filter((c) => !c.meaning)];
}
