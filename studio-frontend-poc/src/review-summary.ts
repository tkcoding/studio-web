/**
 * What a component's quality grade says needs a look, for the Components
 * table's Review column: the grade's criteria (studio-backend
 * `components_catalog/quality.rs`), split into what failed on an answer and
 * what failed for want of one.
 *
 * The two are different work. A check that failed on an answer is a thing to
 * fix in the component ("Finish the PRD"); one with no answer is a thing to
 * connect or record ("Publish coverage"). The grade itself counts both as
 * failed -- unknown fails -- which is right for the letter and wrong for a
 * reader deciding what to do next.
 */

export interface ReviewPart {
  area: string;
  label: string;
  pass: boolean;
  /** Whether the criterion's input had an answer. Absent from an older backend: read as known. */
  known?: boolean;
  fix: string;
}

export interface ReviewSummary {
  /** The first check to look at: a failure on an answer before one with none, in the grade's order. */
  top?: ReviewPart;
  /** Failed with an answer: work on the component. */
  toReview: ReviewPart[];
  /** Failed for want of an answer: data to connect or record. */
  noData: ReviewPart[];
  total: number;
}

export function reviewOf(parts: readonly ReviewPart[] | undefined | null): ReviewSummary | undefined {
  if (!parts?.length) return undefined;
  const failed = parts.filter((p) => !p.pass);
  const toReview = failed.filter((p) => p.known !== false);
  const noData = failed.filter((p) => p.known === false);
  return { top: toReview[0] ?? noData[0], toReview, noData, total: parts.length };
}

/** "2 to review · 1 without data", or undefined when nothing failed. */
export function reviewCounts(summary: ReviewSummary): string | undefined {
  const pieces = [
    summary.toReview.length ? `${summary.toReview.length} to review` : "",
    summary.noData.length ? `${summary.noData.length} without data` : "",
  ].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : undefined;
}
