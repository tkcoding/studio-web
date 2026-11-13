// How a row of the Specs list reads in its review column.
//
// The count is the server's: `spec-rows` folds every recorded `spec_finding`
// into `findings` and `checked_at` per row (studio-documents `spec_rows.rs`,
// rule in artifact-ingest `placed_findings`). This page used to page every
// verdict of the project and count them itself, which is how it came to
// disagree with the projects table about what a failing verdict is. What is
// left here is only the wording, the same four states the FrontX portal shows.

import type { SpecRow } from "./api";

export interface RowReview {
  label: string;
  /** The dot beside the label. */
  tone: string;
}

const MUTED = "var(--muted-foreground)";

/** Needs type · Check needed · N findings · 0 findings.
 *
 *  `reviewsKnown` false means the verdicts could not be read: a typed row then
 *  says nothing rather than "Check needed", which would claim nobody looked. */
export function rowReview(
  row: Pick<SpecRow, "type_key" | "state" | "checked_at" | "findings">,
  reviewsKnown = true,
): RowReview {
  if (row.state === "not_a_document") return { label: "Not a document", tone: MUTED };
  if (!row.type_key) return { label: "Needs type", tone: MUTED };
  if (!reviewsKnown) return { label: "—", tone: MUTED };
  // Findings first: a verdict recorded before verdicts were dated counts but
  // leaves `checked_at` null, and it is still something to fix.
  const n = row.findings ?? 0;
  if (n > 0) return { label: `${n} finding${n === 1 ? "" : "s"}`, tone: "var(--destructive)" };
  // No dated verdict from any detector.
  if (!row.checked_at) return { label: "Check needed", tone: "var(--warning)" };
  return { label: "0 findings", tone: "var(--success)" };
}

/** A member's ✓ (a real problem) or ✗ (not one) on a finding, by fingerprint. */
export type FindingDecision = "confirmed" | "dismissed";

/** A detector's findings with the decisions members gave: the ones still to
 *  act on first (confirmed before undecided, the detector's order kept), and
 *  the dismissed ones apart, so they can be shown folded rather than lost. */
export function withDecisions<T extends { id: string }>(
  items: T[],
  decisions: Record<string, FindingDecision>,
): { open: (T & { decision?: FindingDecision })[]; dismissed: T[] } {
  const open: (T & { decision?: FindingDecision })[] = [];
  const dismissed: T[] = [];
  for (const item of items) {
    const d = decisions[item.id];
    if (d === "dismissed") dismissed.push(item);
    else open.push(d ? { ...item, decision: d } : item);
  }
  open.sort((a, b) => Number(b.decision === "confirmed") - Number(a.decision === "confirmed"));
  return { open, dismissed };
}
