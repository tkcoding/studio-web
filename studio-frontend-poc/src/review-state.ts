// What the model proposes becomes the project's reading only once a member
// accepts it, and a reading a member rejected is not proposed again while its
// passage says the same (PRD "Define the domain model": fr-review). These key
// a fact the way its review is stored and lay the reviews over the model.
// Pure: spec-model-tab.tsx loads and saves, domain-model-screens.tsx draws.

import { createContext } from "react";

import { subjectKey, type SpecModelFact } from "./spec-model";

export type ReviewState = "accepted" | "rejected";

export interface SpecModelReview {
  fact_key: string;
  /** `accepted` or `rejected` on a fact; on a hypothesis (key `ev:…`), what
   *  checking found: `supports`, `contradicts` or `insufficient`. */
  state: string;
  path: string;
  revision: string;
  note?: string | null;
  decided_by: string;
  decided_at: string;
}

/** One review as the reviews endpoint takes it. */
export interface ReviewWrite {
  fact_key: string;
  state: string;
  path: string;
  revision: string;
  note?: string | null;
}

/** 64-bit FNV-1a as 16 hex digits: short, stable, the same everywhere. */
export function fnv64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    h2 = (h2 + (h1 >>> 7)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** A fact as its review is keyed: what it says of what, and the words it was
 *  read from, folded. Another line number or revision is the same reading;
 *  a changed passage is a new one, proposed afresh. */
export function factKey(f: Pick<SpecModelFact, "kind" | "subject" | "aspect" | "text" | "source">): string {
  const words = (s: string) =>
    s
      .replace(/[*`|_]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  return fnv64(`${f.kind}\u001f${subjectKey(f.subject)}\u001f${words(f.aspect)}\u001f${words(f.source.quote || f.text)}`);
}

/** Each fact's review by its key. */
export function reviewIndex(reviews: SpecModelReview[]): Map<string, ReviewState> {
  return new Map(reviews.filter((r) => r.state === "accepted" || r.state === "rejected").map((r) => [r.fact_key, r.state as ReviewState]));
}

/** A hypothesis's evidence is stored beside its fact's review, under this
 *  prefix: a fact's own key is bare hex and never has it. */
export const EVIDENCE_PREFIX = "ev:";

/** Every review by its full key, with the note it carries: obligations
 *  (`ob:`) and matches across projects (`rel:`) read their decision here. */
export function decisionIndex(reviews: SpecModelReview[]): Map<string, { state: string; note: string | null }> {
  return new Map(reviews.map((r) => [r.fact_key, { state: r.state, note: r.note ?? null }]));
}

/** What checking found for each hypothesis, by its fact's key. */
export function evidenceIndex(reviews: SpecModelReview[]): Map<string, string> {
  return new Map(reviews.filter((r) => r.fact_key.startsWith(EVIDENCE_PREFIX)).map((r) => [r.fact_key.slice(EVIDENCE_PREFIX.length), r.state]));
}

/** The facts the model is built from: everything not rejected. */
export function withoutRejected(facts: SpecModelFact[], index: Map<string, ReviewState>): SpecModelFact[] {
  return index.size === 0 ? facts : facts.filter((f) => index.get(factKey(f)) !== "rejected");
}

/** How a selection of facts stands: accepted, rejected, still proposed. */
export function reviewCounts(facts: SpecModelFact[], index: Map<string, ReviewState>): Record<ReviewState | "proposed", number> {
  const out = { accepted: 0, rejected: 0, proposed: 0 };
  for (const f of facts) out[index.get(factKey(f)) ?? "proposed"]++;
  return out;
}

/** What the entity card and a fact's row need to review: where a fact
 *  stands, the rejected facts of a subject, and the action. Absent where
 *  nobody may review (a read-only view). */
export interface FactReview {
  stateOf: (f: SpecModelFact) => ReviewState | undefined;
  /** Reviewed while its document was at another revision: the words are the
   *  same, the text around them may not be — worth a second look. */
  reviewedEarlier?: (f: SpecModelFact) => boolean;
  rejectedOf: (keys: string[]) => SpecModelFact[];
  review: (facts: SpecModelFact[], state: ReviewState | "proposed") => Promise<void>;
}

export const FactReviewContext = createContext<FactReview | null>(null);
