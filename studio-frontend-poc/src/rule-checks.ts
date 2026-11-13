// Checks over the rules a member confirmed (PRD "Define the domain model and
// behaviour": fr-formalisation, fr-rule-checks). Each confirmed constraint is
// read into a precise form a person can see — who may do what, a number that
// bounds something — and the forms are checked against each other, with four
// outcomes: a conflict with the two passages that witness it, no conflict
// among what was read, incomplete (the form lacks a part), or unsupported (a
// rule this reading has no form for). Unconfirmed text gives no verdict: it
// is only counted. Deterministic and pure.

import { subjectKey, type SpecModelFact } from "./spec-model";

export type RuleForm =
  | { form: "permission"; roles: string[]; only: boolean; deny: boolean; action: string; object: string }
  | { form: "limit"; bound: "max" | "min" | "exact"; n: number; what: string; object: string };

export interface ReadRule {
  fact: SpecModelFact;
  /** The precise reading, or why there is none. */
  reading: RuleForm | null;
  outcome: "read" | "incomplete" | "unsupported";
  why?: string;
}

export interface RuleConflict {
  a: ReadRule;
  b: ReadRule;
  /** What cannot both hold, in a sentence: the witness. */
  witness: string;
}

const ROLE_WORDS = /\b(only|admins?|administrators?|owners?|members?|viewers?|editors?|operators?|managers?|authors?|readers?|reviewers?|users?|anyone|nobody|no one|everyone|guests?|platform administrators?)\b/gi;

const words = (s: string) => subjectKey(s);

/** A role named as a plural or singular reads the same. */
export const role = (r: string) => words(r).replace(/^(admin|administrator)$/, "administrator");

/** Read one constraint into a form; null with a reason where it has none. */
export function readRule(f: SpecModelFact): ReadRule {
  const text = `${f.aspect} ${f.value} ${f.text}`.replace(/\s+/g, " ");
  const object = words(f.subject);
  // Numbers first: "at most 5 sessions", "no more than 3", "exactly one owner".
  const num = /\b(at most|no more than|up to|maximum of|max(?:imum)?|at least|minimum of|min(?:imum)?|exactly|only one|one)\b\s*(\d+|one|two|three|four|five|ten)?\s*([a-z][a-z-]{1,30})?/i.exec(text);
  const n = (s: string | undefined) => (s === undefined ? NaN : /^\d+$/.test(s) ? Number(s) : ({ one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 } as Record<string, number>)[s.toLowerCase()] ?? NaN);
  if (num && /\d|one|two|three|four|five|ten/i.test(num[0])) {
    const kw = num[1].toLowerCase();
    const value = kw === "only one" || (kw === "one" && !num[2]) ? 1 : n(num[2]);
    const bound = /most|more than|up to|max/.test(kw) ? "max" : /least|min/.test(kw) ? "min" : "exact";
    const what = words(num[3] ?? f.aspect);
    if (!Number.isFinite(value)) return { fact: f, reading: null, outcome: "incomplete", why: "names a bound but no number" };
    if (!what) return { fact: f, reading: null, outcome: "incomplete", why: "names a number but not what it counts" };
    return { fact: f, reading: { form: "limit", bound, n: value, what, object }, outcome: "read" };
  }
  // Permissions: "only owners may delete", "viewers cannot edit", "who may read: members".
  const may = /\b(may|can|is allowed to|are allowed to|must not|may not|cannot|can't|is not allowed to)\b\s+([a-z]+)/i.exec(text);
  const who = /who may ([a-z]+)/i.exec(f.aspect);
  if (may || who) {
    const verb = words(who ? who[1] : may![2]);
    const named = who && f.value.trim() ? f.value : text;
    const roles = [...new Set([...named.matchAll(ROLE_WORDS)].map((m) => m[0]).filter((r) => !/^only$/i.test(r)).map(role))];
    const deny = /\b(must not|may not|cannot|can't|not allowed)\b/i.test(text);
    const only = /\bonly\b/i.test(text);
    if (!verb) return { fact: f, reading: null, outcome: "incomplete", why: "says who, not what they may do" };
    if (roles.length === 0) return { fact: f, reading: null, outcome: "incomplete", why: "says what may be done, not by whom" };
    return { fact: f, reading: { form: "permission", roles, only, deny, action: verb, object }, outcome: "read" };
  }
  return { fact: f, reading: null, outcome: "unsupported", why: "not a permission or a numeric bound this check reads" };
}

/** A reading in words, so a person can confirm it is what the rule means. */
export function describe(r: RuleForm): string {
  if (r.form === "limit") return `${r.object}: ${r.bound === "max" ? "at most" : r.bound === "min" ? "at least" : "exactly"} ${r.n} ${r.what}`;
  return `${r.only ? "only " : ""}${r.roles.join(", ")} ${r.deny ? "may not" : "may"} ${r.action} ${r.object}`;
}

/** Pairs of confirmed rules that cannot both hold. */
export function conflicts(rules: ReadRule[]): RuleConflict[] {
  const out: RuleConflict[] = [];
  const read = rules.filter((r) => r.reading);
  for (let i = 0; i < read.length; i++)
    for (let j = i + 1; j < read.length; j++) {
      const a = read[i];
      const b = read[j];
      const x = a.reading!;
      const y = b.reading!;
      if (x.object !== y.object) continue;
      if (x.form === "limit" && y.form === "limit" && x.what === y.what) {
        const [lo, hi] = x.bound === "min" ? [x, y] : [y, x];
        const clash =
          (lo.bound === "min" && hi.bound === "max" && lo.n > hi.n) ||
          (x.bound === "exact" && y.bound === "exact" && x.n !== y.n) ||
          (x.bound === "exact" && y.bound === "max" && x.n > y.n) ||
          (y.bound === "exact" && x.bound === "max" && y.n > x.n) ||
          (x.bound === "exact" && y.bound === "min" && x.n < y.n) ||
          (y.bound === "exact" && x.bound === "min" && y.n < x.n) ||
          (x.bound === "max" && y.bound === "max" && x.n !== y.n) ||
          (x.bound === "min" && y.bound === "min" && x.n !== y.n);
        if (clash) out.push({ a, b, witness: `${describe(x)}, but also ${describe(y)}` });
      }
      if (x.form === "permission" && y.form === "permission" && x.action === y.action) {
        const shared = x.roles.filter((r) => y.roles.includes(r));
        if (shared.length && x.deny !== y.deny) {
          out.push({ a, b, witness: `${shared.join(", ")} ${x.deny ? "may not" : "may"} ${x.action} ${x.object} by one rule, and ${y.deny ? "may not" : "may"} by the other` });
          continue;
        }
        const allowedOnly = x.only && !x.deny ? x : y.only && !y.deny ? y : null;
        const other = allowedOnly === x ? y : x;
        if (allowedOnly && !other.deny) {
          const outside = other.roles.filter((r) => !allowedOnly.roles.includes(r));
          if (outside.length) out.push({ a, b, witness: `only ${allowedOnly.roles.join(", ")} may ${x.action} ${x.object}, yet ${outside.join(", ")} may too` });
        }
      }
    }
  return out;
}
