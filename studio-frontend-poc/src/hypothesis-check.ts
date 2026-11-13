// A hypothesis and its check as objects of the project's model (PRD "Validate
// product hypotheses"): the hypothesis is an expected benefit the documents
// state (need-view.ts hypothesesOf); its check is a record beside it — which
// methods, when (research, an experiment, after implementation), a brief, and
// what checking found — kept as a review keyed `hyp:`. Where the hypothesis
// stands stays the `ev:` review with its four states. The methods are a
// catalogue: the five the PRD confirms, built in, and whatever a kit the
// project installed adds. Nothing here decides a hypothesis is true: a check
// is planned and its result recorded by a person. Pure: discovery-screens.tsx
// draws it, spec-model-tab.tsx loads and saves.

import { EVIDENCE_LABEL, proposeMethod, type EvidenceState, type Hypothesis } from "./need-view";
import { factKey, type ReviewWrite, type SpecModelReview } from "./review-state";
import { subjectKey, type SpecRequirement } from "./spec-model";

/** A way to check a claim, as the PRD's method table describes one. */
export interface MethodDef {
  /** `problem`…`existing` for the built-in ones; `<kit>/<id>` for a kit's. */
  id: string;
  label: string;
  /** The uncertainty it addresses. */
  uncertainty: string;
  /** What it needs from earlier steps or materials. */
  inputs: string;
  /** What to do and what comes out. */
  action: string;
  /** What a result of it cannot establish. */
  limits: string;
  /** The kit that adds it; null for a built-in one. */
  kit: string | null;
  /** Words in a claim that make it apply (a kit's); the built-in ones are
   *  proposed from the claim's kind of uncertainty instead. */
  appliesTo: string[];
}

export const BUILTIN_METHODS: MethodDef[] = [
  {
    id: "problem",
    label: "Problem evidence",
    uncertainty: "Does the target role face the problem?",
    inputs: "The role, the problem and its context; interviews, requests and earlier research.",
    action: "Gather the reports for and against, the conditions they describe and today's workarounds.",
    limits: "Reports about other people do not establish that these customers have the need.",
    kit: null,
    appliesTo: [],
  },
  {
    id: "benefit",
    label: "Expected benefit",
    uncertainty: "Will the proposed approach help perform the task?",
    inputs: "The hypothesis, the role, task and context, and the approaches known today.",
    action: "Find comparable cases and their reported outcomes; or plan an experiment with a UI or simple-service prototype and the relevant users; or a check after implementation.",
    limits: "Novelty or no precedent does not disprove it; some effects can only be checked on the implemented product.",
    kit: null,
    appliesTo: [],
  },
  {
    id: "tco",
    label: "Time / TCO estimate",
    uncertainty: "Will the approach be faster or cheaper?",
    inputs: "The workload, earlier approaches and the systems named, times and costs the materials give, public prices.",
    action: "A Fermi estimate: break the cost down, reuse known unit prices, label each assumption, show the calculation and a range.",
    limits: "An estimate, not actual spend; an assumption is never shown as a fact, and an unknown item leaves the total partial.",
    kit: null,
    appliesTo: [],
  },
  {
    id: "demand",
    label: "Demand",
    uncertainty: "Do people want or use this functionality?",
    inputs: "Links between problems and features, requests, earlier demand checks, documented use of alternatives.",
    action: "Gather the signals for and against, with who gave each and under what conditions.",
    limits: "A competitor's feature is not demand; messages are not a share of customers.",
    kit: null,
    appliesTo: [],
  },
  {
    id: "existing",
    label: "Existing capability",
    uncertainty: "Can an available product already do this?",
    inputs: "The capability, the product named, its descriptions, requirements and code, earlier decisions.",
    action: "Check the product's described behaviour against what is claimed, with its conditions and discrepancies.",
    limits: "Establishes a capability, not a customer benefit; code being there does not mean it is deployed.",
    kit: null,
    appliesTo: [],
  },
];

/** Why the built-in method was proposed, in the words of its rule. */
const BUILTIN_WHY: Record<string, string> = {
  tco: "the claim speaks of time, effort or cost",
  demand: "the claim speaks of what customers ask for",
  existing: "the claim speaks of what exists already",
  problem: "the claim speaks of a difficulty people have",
  benefit: "the claim expects an effect",
};

/** The methods this project can use: the built-in ones, then each kit's,
 *  named by kit so two kits never collide with each other or the built-ins. */
export function methodCatalogue(kitMethods: MethodDef[]): MethodDef[] {
  const out = [...BUILTIN_METHODS];
  for (const m of kitMethods) {
    const id = m.kit ? `${m.kit}/${m.id.replace(/^.*\//, "")}` : m.id;
    if (!out.some((x) => x.id === id)) out.push({ ...m, id });
  }
  return out;
}

/** The methods proposed for a claim, each with the reason: the built-in one
 *  its kind of uncertainty calls for, and every kit method whose words it
 *  uses. A person picks among them or any other. */
export function proposedMethods(h: Hypothesis, catalogue: MethodDef[]): { id: string; why: string }[] {
  const claim = `${h.solution} ${h.effect} ${h.fact.text}`;
  const builtin = proposeMethod(claim);
  const out: { id: string; why: string }[] = [{ id: builtin, why: BUILTIN_WHY[builtin] }];
  const said = ` ${subjectKey(claim)} `;
  for (const m of catalogue.filter((x) => x.kit)) {
    const hit = m.appliesTo.find((w) => subjectKey(w) && said.includes(` ${subjectKey(w)} `));
    if (hit) out.push({ id: m.id, why: `the ${m.kit} kit applies it to claims about “${hit}”` });
  }
  return out;
}

/** When a hypothesis is checked: by research among available materials, by
 *  an experiment with people, or once it is built. Choosing one never makes
 *  it supported. */
export type Timing = "research" | "experiment" | "after-implementation";

export const TIMING_LABEL: Record<Timing, string> = {
  research: "Research available materials",
  experiment: "An experiment with people",
  "after-implementation": "After implementation",
};

/** A hypothesis's check as a member left it. */
export interface Check {
  methods: string[];
  timing: Timing | null;
  /** The brief, as proposed and edited. */
  brief: string;
  /** The criterion agreed to read a result by; empty when none is, and a
   *  result then stays exploratory. */
  criterion: string;
  /** What checking found, in the member's words or pasted. */
  result: string;
}

export const CHECK_PREFIX = "hyp:";

/** The most a check's record may hold. */
export const CHECK_NOTE_MAX = 8000;

const parse = (note: string | null | undefined): Partial<Check> | null => {
  try {
    return note ? (JSON.parse(note) as Partial<Check>) : null;
  } catch {
    return null;
  }
};

/** Each hypothesis's check by its fact's key. */
export function checkIndex(reviews: SpecModelReview[]): Map<string, Check> {
  const out = new Map<string, Check>();
  for (const r of reviews) {
    if (!r.fact_key.startsWith(CHECK_PREFIX) || r.state !== "check") continue;
    const c = parse(r.note);
    if (!c) continue;
    out.set(r.fact_key.slice(CHECK_PREFIX.length), {
      methods: Array.isArray(c.methods) ? c.methods.filter((m): m is string => typeof m === "string") : [],
      timing: c.timing === "research" || c.timing === "experiment" || c.timing === "after-implementation" ? c.timing : null,
      brief: typeof c.brief === "string" ? c.brief : "",
      criterion: typeof c.criterion === "string" ? c.criterion : "",
      result: typeof c.result === "string" ? c.result : "",
    });
  }
  return out;
}

/** The bytes a check's record takes: what the 8000-byte limit counts. */
export function checkSize(check: Check): number {
  return new TextEncoder().encode(JSON.stringify(check)).length;
}

/** A check as a record, kept beside the hypothesis it is for. */
export function checkWrite(h: Hypothesis, check: Check, revision: string): ReviewWrite {
  if (checkSize(check) > CHECK_NOTE_MAX) throw new Error(`The check is longer than ${CHECK_NOTE_MAX} bytes; shorten the brief or the result.`);
  return { fact_key: `${CHECK_PREFIX}${factKey(h.fact)}`, state: "check", path: h.fact.source.path, revision, note: JSON.stringify(check) };
}

const where = (h: Hypothesis) => `${h.fact.source.path}${h.fact.source.line_start ? `:${h.fact.source.line_start}` : ""}`;

/** A brief proposed from the hypothesis and the methods chosen (PRD
 *  fr-check-brief): the uncertain statement, for whom, what to observe, what
 *  is known, and the criterion — left open, never made up. */
export function proposedBrief(h: Hypothesis, methods: MethodDef[], timing: Timing | null): string {
  const lines = [
    `Claim: ${h.solution || "(the solution is not named)"} — ${h.effect || "(the effect is not stated)"}, for ${h.role || "(nobody named)"}.`,
    ...methods.map((m) => `${m.label}: ${m.uncertainty} ${m.action}`),
    timing ? `When: ${TIMING_LABEL[timing]}.` : "When: not chosen yet.",
    `Known so far: ${where(h)}${h.fact.source.quote ? ` — “${h.fact.source.quote}”` : ""}.`,
    "Criterion: not agreed yet — a result read without one is exploratory.",
    ...methods.map((m) => `Limit (${m.label}): ${m.limits}`),
  ];
  return lines.join("\n");
}

/** The hypotheses as a document to read: each with where it stands, how it
 *  is checked and what was found. Written from the records; the records stay
 *  the source, docs/hypotheses.md is what a reader opens. */
export function hypothesesDocument(list: Hypothesis[], stateOf: (h: Hypothesis) => EvidenceState, checkOf: (h: Hypothesis) => Check | undefined, catalogue: MethodDef[]): string {
  const label = (id: string) => catalogue.find((m) => m.id === id)?.label ?? id;
  const out = [
    "---",
    "type: material",
    "---",
    "",
    "# Hypotheses",
    "",
    "<!-- Written by Studio from the project's hypotheses and their checks. Accepting the wording is not validating it. -->",
    "",
  ];
  const order: EvidenceState[] = ["contradicts", "insufficient", "unchecked", "supports"];
  for (const state of order) {
    const here = list.filter((h) => stateOf(h) === state);
    if (!here.length) continue;
    out.push(`## ${EVIDENCE_LABEL[state]}`, "");
    for (const h of here) {
      const c = checkOf(h);
      out.push(`### ${h.solution || "A solution not named"}`, "");
      out.push(`- **Expected:** ${h.effect || "_not stated_"}`, `- **For:** ${h.role || "_nobody named_"}`, `- **Read from:** \`${where(h)}\``);
      if (c?.methods.length) out.push(`- **Checked by:** ${c.methods.map(label).join(", ")}`);
      if (c?.timing) out.push(`- **When:** ${TIMING_LABEL[c.timing]}`);
      out.push(`- **Criterion:** ${c?.criterion.trim() || "_not agreed — a result is exploratory_"}`);
      if (c?.result.trim()) out.push("", "What checking found:", "", ...c.result.trim().split("\n").map((l) => `> ${l}`));
      out.push("");
    }
  }
  return out.join("\n");
}

/** The hypotheses about a requirement: those whose solution its title or
 *  text names, or that name its identifier. A word found is a link to look
 *  at, not proof the two are about the same thing. */
export function hypothesesFor(r: Pick<SpecRequirement, "id" | "title" | "text">, list: Hypothesis[]): Hypothesis[] {
  const said = ` ${subjectKey(`${r.title ?? ""} ${r.text}`)} `;
  return list.filter((h) => {
    const s = subjectKey(h.solution);
    return (s.length > 3 && said.includes(` ${s} `)) || (r.id.length > 3 && h.fact.text.includes(r.id));
  });
}
