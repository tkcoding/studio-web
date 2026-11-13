// What kind of requirement an identifier is, in the words a specification
// uses: business, user, functional, non-functional, data, interfaces and
// integrations, business rules, constraints, transition. And what is not a
// requirement at all — a component, a sequence, a table — but a part of the
// design that carries one.
//
// The categories overlap on purpose. Business and user requirements are a
// level of description; functional and non-functional are the nature of a
// requirement. So each identifier gets a type (what the Requirements view
// groups by), a level and a nature. Read from the identifier's kind and the
// kind of document that defines it; nothing here asks a model. Pure:
// domain-model-screens.tsx draws what these compute.

import type { SpecRequirement } from "./spec-model";

export type RequirementType =
  | "business"
  | "user"
  | "functional"
  | "nonfunctional"
  | "data"
  | "interface"
  | "rule"
  | "constraint"
  | "transition";

/** In the order a specification usually states them. */
export const REQUIREMENT_TYPES: RequirementType[] = [
  "business",
  "user",
  "functional",
  "nonfunctional",
  "data",
  "interface",
  "rule",
  "constraint",
  "transition",
];

export const REQUIREMENT_TYPE_LABEL: Record<RequirementType, string> = {
  business: "Business",
  user: "User",
  functional: "Functional",
  nonfunctional: "Non-functional",
  data: "Data",
  interface: "Interfaces & integrations",
  rule: "Business rules",
  constraint: "Constraints",
  transition: "Transition",
};

/** The type said of many: "business rules", "constraints". */
export const REQUIREMENT_TYPE_NOUN: Record<RequirementType, string> = {
  business: "business requirements",
  user: "user requirements",
  functional: "functional requirements",
  nonfunctional: "non-functional requirements",
  data: "data requirements",
  interface: "interface and integration requirements",
  rule: "business rules",
  constraint: "constraints",
  transition: "transition requirements",
};

/** What each type says, with an example: shown where a type has none. */
export const REQUIREMENT_TYPE_WHAT: Record<RequirementType, string> = {
  business: "the goal and the benefit for the organization — “cut the time to handle a request by 30%”",
  user: "what users need to do — “an operator finds a request by its number”",
  functional: "what the system does — “the system notifies when a request's status changes”",
  nonfunctional: "how well it does it — “a search answers within 2 seconds”",
  data: "what data is kept, in what form, and what keeps it whole — “a request's number is unique”",
  interface: "how it meets people and other systems — “requests arrive from the CRM through an API”",
  rule: "the rules of the domain — “a request over 100 000 is approved by a manager”",
  constraint: "what the implementation must stay within — “the existing company database is used”",
  transition: "what launching it takes — “open requests move from the old system before launch”",
};

export type RequirementLevel = "business" | "user" | "system";
export type RequirementNature = "functional" | "nonfunctional";

export interface RequirementClass {
  type: RequirementType;
  level: RequirementLevel;
  nature: RequirementNature | null;
}

/** Kinds that name a part of the design, not something asked of it. */
const DESIGN_KINDS = new Set([
  "component",
  "design",
  "seq",
  "adr",
  "feature",
  "featstatus",
  "state",
  "status",
  "entity",
  "dbtable",
  "db",
  "topology",
  "tech",
  "actor",
]);

/** Kinds read the same wherever they are defined. */
const BY_KIND: Record<string, RequirementType> = {
  goal: "business",
  objective: "business",
  business: "business",
  usecase: "user",
  story: "user",
  fr: "functional",
  flow: "functional",
  algo: "functional",
  dod: "functional",
  nfr: "nonfunctional",
  quality: "nonfunctional",
  data: "data",
  interface: "interface",
  contract: "interface",
  integration: "interface",
  rule: "rule",
  constraint: "constraint",
  migration: "transition",
  rollout: "transition",
  transition: "transition",
};

const isProductDoc = (path: string) => /(^|\/)prd(\/|[-.])/i.test(path);

/** A requirement's type, level and nature; `null` for a part of the design.
 *  A principle is a rule of the domain where the product is described, and a
 *  quality the design keeps everywhere else. */
export function classify(r: Pick<SpecRequirement, "kind" | "defined_in">): RequirementClass | null {
  const kind = (r.kind ?? "").toLowerCase();
  if (!kind || DESIGN_KINDS.has(kind)) return null;
  const product = isProductDoc(r.defined_in.path);
  const type: RequirementType | undefined = kind === "principle" ? (product ? "rule" : "nonfunctional") : BY_KIND[kind];
  if (!type) return null;
  const level: RequirementLevel = type === "business" ? "business" : type === "user" || (product && type === "functional") ? "user" : "system";
  const nature: RequirementNature | null =
    type === "nonfunctional" || type === "constraint" ? "nonfunctional" : type === "functional" || type === "user" ? "functional" : null;
  return { type, level, nature };
}

export interface TypeTally {
  type: RequirementType;
  n: number;
  /** How many cite a source or give a reason: what they rest on. */
  grounded: number;
}

/** Each type with how many requirements it has and how many rest on
 *  something; every type, so an empty one shows as the gap it is. */
export function tallyTypes(items: SpecRequirement[]): { types: TypeTally[]; design: number } {
  const by = new Map<RequirementType, TypeTally>(REQUIREMENT_TYPES.map((t) => [t, { type: t, n: 0, grounded: 0 }]));
  let design = 0;
  for (const r of items) {
    const c = classify(r);
    if (!c) {
      design++;
      continue;
    }
    const t = by.get(c.type)!;
    t.n++;
    if (r.basis === "cited" || r.basis === "reasoned") t.grounded++;
  }
  return { types: REQUIREMENT_TYPES.map((t) => by.get(t)!), design };
}

/** Where a type is written in the SDLC kit's PRD, and where the design
 *  takes over what the PRD leaves to it. */
export const REQUIREMENT_TYPE_SECTION: Record<RequirementType, { doc: "prd" | "design"; section: string }> = {
  business: { doc: "prd", section: "Goals (Business Outcomes)" },
  user: { doc: "prd", section: "Use Cases" },
  functional: { doc: "prd", section: "Functional Requirements" },
  nonfunctional: { doc: "prd", section: "Non-Functional Requirements" },
  data: { doc: "design", section: "Domain Model" },
  interface: { doc: "prd", section: "Public Library Interfaces (External Integration Contracts)" },
  rule: { doc: "prd", section: "Functional Requirements, as rules of the domain" },
  constraint: { doc: "prd", section: "Operational Concept & Environment (constraints)" },
  transition: { doc: "prd", section: "a section of its own: Transition and rollout" },
};

export interface RequirementProblem {
  type: RequirementType;
  severity: "missing" | "few" | "ungrounded";
  /** What is wrong, in a sentence. */
  title: string;
  /** Why it matters. */
  why: string;
  /** Where to write them: the document and its section; `path` is the
   *  project's own document of that kind when it has one. */
  where: { path: string | null; section: string };
}

/** Too few next to the functional ones: one in this many, at least. */
const NFR_PER_FR = 0.15;
const MIN_NFR = 5;

/** What is wrong with the requirements as a whole: a type nobody wrote, too
 *  few non-functional or user requirements for what the system is asked to
 *  do, a type that mostly rests on nothing. The worst first. */
export function requirementProblems(items: SpecRequirement[]): RequirementProblem[] {
  const { types } = tallyTypes(items);
  const n = (t: RequirementType) => types.find((x) => x.type === t)!.n;
  const docOf = (kind: "prd" | "design") => {
    const counts = new Map<string, number>();
    for (const r of items) {
      const p = r.defined_in.path;
      if (kind === "prd" ? isProductDoc(p) : /(^|\/)design(\/|[-.])/i.test(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const where = (t: RequirementType) => ({ path: docOf(REQUIREMENT_TYPE_SECTION[t].doc), section: REQUIREMENT_TYPE_SECTION[t].section });
  const out: RequirementProblem[] = [];
  const fr = n("functional");
  if (fr === 0 && items.length === 0) return out;

  for (const t of REQUIREMENT_TYPES) {
    if (n(t) > 0) continue;
    out.push({
      type: t,
      severity: "missing",
      title: `No ${REQUIREMENT_TYPE_NOUN[t]}`,
      why: `None says ${REQUIREMENT_TYPE_WHAT[t]}.`,
      where: where(t),
    });
  }
  const nfr = n("nonfunctional");
  const wantNfr = Math.max(MIN_NFR, Math.ceil(fr * NFR_PER_FR));
  if (nfr > 0 && nfr < wantNfr) {
    out.push({
      type: "nonfunctional",
      severity: "few",
      title: `Only ${nfr} non-functional requirement${nfr === 1 ? "" : "s"} for ${fr} functional`,
      why: `Speed, availability, security, limits and recovery go unsaid, so each part decides them alone. Expect about ${wantNfr}.`,
      where: where("nonfunctional"),
    });
  }
  const user = n("user");
  if (user > 0 && fr >= 20 && user < Math.ceil(fr / 10)) {
    out.push({
      type: "user",
      severity: "few",
      title: `Only ${user} user requirement${user === 1 ? "" : "s"} for ${fr} functional`,
      why: "Functions no user task asks for are hard to check against what people need.",
      where: where("user"),
    });
  }
  for (const t of types) {
    if (t.n < 5 || t.grounded / t.n >= 0.3) continue;
    out.push({
      type: t.type,
      severity: "ungrounded",
      title: `${t.n - t.grounded} of ${t.n} ${REQUIREMENT_TYPE_NOUN[t.type]} rest on nothing`,
      why: "They cite no source and give no reason, so nobody can tell whether one may change.",
      where: where(t.type),
    });
  }
  const order = { missing: 0, few: 1, ungrounded: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity] || REQUIREMENT_TYPES.indexOf(a.type) - REQUIREMENT_TYPES.indexOf(b.type));
}
