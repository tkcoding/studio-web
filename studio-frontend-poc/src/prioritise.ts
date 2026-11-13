// Prioritising functionality the way the PRD "Prioritise functionality"
// ships it first: ICE, the mean of Impact, Confidence and Ease, each 1–10,
// higher is better, with every value's origin kept and an unknown kept
// unknown — never a 1 in disguise. Business value and delivery order stay
// apart: the score ranks, prerequisites then decide what can come first, and
// a cycle among them is shown, not quietly broken. Pure and reproducible: the
// same inputs give the same order.

import type { RequirementBasis } from "./spec-model";

/** Where a value comes from. A Studio estimate is never shown as a
 *  measurement, nor a person's entry as either. */
export type Origin = "measured" | "estimated" | "entered" | "unknown";

export interface Criterion {
  /** The score on the method's scale; a range when the estimate crosses a
   *  band; absent when unknown. */
  score?: number;
  range?: [number, number];
  origin: Origin;
  /** What it rests on, in a sentence a reviewer can check. */
  basis: string;
}

export interface IceInputs {
  impact: Criterion;
  confidence: Criterion;
  ease: Criterion;
}

export type IceCriterion = keyof IceInputs;

export const ICE_LABEL: Record<IceCriterion, string> = {
  impact: "Impact",
  confidence: "Confidence",
  ease: "Ease",
};

export const unknown = (basis = "Nothing supports a value yet."): Criterion => ({ origin: "unknown", basis });

export interface IceScore {
  /** The mean, when every criterion has a value; else null. */
  score: number | null;
  /** The lowest and highest mean a range allows. */
  range: [number, number] | null;
  /** The criteria with no value: why the score is incomplete. */
  missing: IceCriterion[];
  /** A value off the 1–10 scale: the score is not valid. */
  invalid: IceCriterion[];
}

const ON_SCALE = (n: number) => Number.isFinite(n) && n >= 1 && n <= 10;

/** ICE as the PRD defines it: the mean of the three, each 1–10. */
export function iceScore(i: IceInputs): IceScore {
  const keys: IceCriterion[] = ["impact", "confidence", "ease"];
  const missing = keys.filter((k) => i[k].score === undefined && !i[k].range);
  const invalid = keys.filter((k) => {
    const c = i[k];
    return (c.score !== undefined && !ON_SCALE(c.score)) || (c.range !== undefined && !(ON_SCALE(c.range[0]) && ON_SCALE(c.range[1])));
  });
  if (missing.length || invalid.length) return { score: null, range: null, missing, invalid };
  const lo = keys.map((k) => i[k].range?.[0] ?? i[k].score!);
  const hi = keys.map((k) => i[k].range?.[1] ?? i[k].score!);
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
  const ranged = keys.some((k) => i[k].range);
  const point = keys.every((k) => i[k].score !== undefined) ? mean(keys.map((k) => i[k].score!)) : null;
  return { score: point ?? (ranged ? null : mean(lo)), range: ranged ? [mean(lo), mean(hi)] : null, missing: [], invalid: [] };
}

/** Ease from total effort in person-weeks, by the PRD's default bands: up to
 *  1 → 10, to 2 → 8, to 4 → 6, to 8 → 4, over 8 → 2. A range that crosses
 *  bands gives a range, not a made-up point. */
export function easeFromEffort(personWeeks: number | [number, number], basis: string, origin: Origin = "estimated"): Criterion {
  const band = (w: number) => (w <= 1 ? 10 : w <= 2 ? 8 : w <= 4 ? 6 : w <= 8 ? 4 : 2);
  if (Array.isArray(personWeeks)) {
    const [a, b] = personWeeks;
    if (!(a > 0 && b >= a)) return { origin: "unknown", basis: `Not an effort range: ${a}–${b} person-weeks.` };
    const [hi, lo] = [band(a), band(b)];
    return hi === lo ? { score: hi, origin, basis } : { range: [lo, hi], origin, basis };
  }
  if (!(personWeeks > 0)) return { origin: "unknown", basis: `Not an effort: ${personWeeks} person-weeks.` };
  return { score: band(personWeeks), origin, basis };
}

/** A first Confidence from what a requirement rests on, on the PRD's
 *  evidence anchors: an assumption or an open question is a weak, unverified
 *  claim (1); a cited source is at best indirect evidence of the effect (3).
 *  A requirement that states no basis gets no number — no basis stays
 *  unknown, not 1. A person corrects it with what was observed. */
export function confidenceFromBasis(basis: RequirementBasis): Criterion {
  switch (basis) {
    case "open_question":
    case "assumption":
      return { score: 1, origin: "estimated", basis: "Rests on an assumption or an open question: a weak, unverified claim." };
    case "cited":
      return { score: 3, origin: "estimated", basis: "Cites a source: indirect evidence, not an observation of the effect." };
    case "reasoned":
      return { score: 1, origin: "estimated", basis: "Gives a reason, no evidence: an unverified claim." };
    default:
      return unknown("States no basis: nothing to estimate how sure the effect is.");
  }
}

/** A hypothesis about an item, as far as checking it went. */
export interface CheckedClaim {
  claim: string;
  state: "unchecked" | "supports" | "contradicts" | "insufficient";
  /** The methods its check used: built-in ids or a kit's. */
  methods: string[];
}

/** A first Confidence from what checking the item's hypotheses found, on the
 *  PRD's evidence anchors (fr-confidence). Checking that supports the expected
 *  effect is direct evidence at best (5) — a pilot (7) or a measurement (9)
 *  is the person's to say; support from problem, demand or capability
 *  evidence alone — or a kit's method, whose reach Studio does not know — is
 *  indirect for the effect (3); a contradiction is a weak
 *  claim (1); for and against together stays unresolved. Null when nothing
 *  was checked: the requirement's own basis then speaks. */
export function confidenceFromHypotheses(claims: CheckedClaim[]): Criterion | null {
  const checked = claims.filter((c) => c.state !== "unchecked");
  if (checked.length === 0) return null;
  const names = (cs: CheckedClaim[]) => cs.map((c) => `“${c.claim}”`).join(", ");
  const supports = checked.filter((c) => c.state === "supports");
  const against = checked.filter((c) => c.state === "contradicts");
  if (supports.length && against.length)
    return unknown(`Checking supports ${names(supports)} and contradicts ${names(against)}: conflicting evidence, for a person to weigh.`);
  if (against.length) return { score: 1, origin: "estimated", basis: `Checking contradicts ${names(against)}.` };
  const forEffect = supports.filter((c) => c.methods.length === 0 || c.methods.some((m) => m === "benefit" || m === "tco"));
  if (forEffect.length)
    return { score: 5, origin: "estimated", basis: `Checking supports the expected effect of ${names(forEffect)}: direct evidence at best; a pilot is 7, a measurement 9.` };
  if (supports.length)
    return { score: 3, origin: "estimated", basis: `Checking supports ${names(supports)} as a problem, demand or capability: indirect evidence of the effect.` };
  return { score: 1, origin: "estimated", basis: `Checking found too little on ${names(checked)}: still an unverified claim.` };
}

export interface Ranked {
  id: string;
  score: number | null;
}

export interface Ordering {
  /** The order: by score, highest first, each only after the prerequisites
   *  in the set; unscored items last. */
  order: string[];
  /** Items whose score equals the one before: a tie, not a decision. */
  ties: Set<string>;
  /** Prerequisites outside the set, per item: required additions. */
  outside: Map<string, string[]>;
  /** Groups that require each other: no order satisfies them. */
  cycles: string[][];
}

/** Delivery order that respects prerequisites, value kept apart: among the
 *  items whose prerequisites in the set are placed, the highest score comes
 *  next (Kahn's algorithm with the score as the key). Ties keep the given
 *  order and are marked. A cycle is reported and its items follow the rest
 *  by score, so nothing is hidden or dropped. */
export function orderItems(items: Ranked[], requires: Map<string, string[]>): Ordering {
  const ids = new Set(items.map((i) => i.id));
  const pos = new Map(items.map((i, n) => [i.id, n]));
  const score = new Map(items.map((i) => [i.id, i.score]));
  const outside = new Map<string, string[]>();
  const pending = new Map<string, Set<string>>();
  for (const i of items) {
    const reqs = requires.get(i.id) ?? [];
    const out = reqs.filter((r) => !ids.has(r));
    if (out.length) outside.set(i.id, out);
    pending.set(i.id, new Set(reqs.filter((r) => ids.has(r) && r !== i.id)));
  }
  const better = (a: string, b: string) => {
    const sa = score.get(a) ?? null;
    const sb = score.get(b) ?? null;
    if (sa !== sb) return sa === null ? 1 : sb === null ? -1 : sb - sa;
    return pos.get(a)! - pos.get(b)!;
  };
  const order: string[] = [];
  const placed = new Set<string>();
  for (;;) {
    const ready = [...pending].filter(([id, reqs]) => !placed.has(id) && [...reqs].every((r) => placed.has(r))).map(([id]) => id);
    if (!ready.length) break;
    const next = ready.sort(better)[0];
    order.push(next);
    placed.add(next);
  }
  const stuck = items.map((i) => i.id).filter((id) => !placed.has(id));
  const cycles = findCycles(stuck, pending);
  order.push(...stuck.sort(better));
  const ties = new Set<string>();
  for (let n = 1; n < order.length; n++) {
    const s = score.get(order[n]);
    if (s !== null && s !== undefined && s === score.get(order[n - 1])) {
      ties.add(order[n]);
      ties.add(order[n - 1]);
    }
  }
  return { order, ties, outside, cycles };
}

/** The strongly connected groups of more than one item (or one that requires
 *  itself through others) among those no order could place. */
function findCycles(stuck: string[], pending: Map<string, Set<string>>): string[][] {
  const inStuck = new Set(stuck);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  let n = 0;
  const visit = (v: string) => {
    index.set(v, n);
    low.set(v, n);
    n++;
    stack.push(v);
    on.add(v);
    for (const w of pending.get(v) ?? []) {
      if (!inStuck.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const group: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) out.push(group.reverse());
    }
  };
  for (const v of stuck) if (!index.has(v)) visit(v);
  return out;
}
