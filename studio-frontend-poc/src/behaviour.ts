// Bounded behaviour coverage (PRD "Define the domain model and behaviour",
// fr-obligations / fr-coverage): from the states an entity goes through and
// the actions roles take on it, the questions a specification has to answer —
// may this role do this to it while it is in that state? A question counts as
// answered only where one passage names both the action and the state; a name
// found elsewhere is not an answer. What is left is asked, or excluded with a
// reason a person gives. And whether what the documents describe can happen
// at all under the rules a member confirmed (fr-scenario-feasibility): an
// action or a scenario step a permission forbids to that role. Pure:
// discovery-screens.tsx draws it.

import { factKey } from "./review-state";
import { describe, role, type ReadRule, type RuleForm } from "./rule-checks";
import { subjectKey, type SpecModelFact } from "./spec-model";

export interface Obligation {
  /** Stable: the entity, the action and the state, folded. */
  key: string;
  entity: string;
  role: string;
  action: string;
  state: string;
  /** The passage that answers it, if one names both. */
  answer: SpecModelFact | null;
  /** The action's own passage: where the question comes from. */
  from: SpecModelFact;
}

/** The states a lifecycle fact lists: "draft, review and approved". */
export function statesOf(f: SpecModelFact): string[] {
  if (f.kind !== "lifecycle" || !/\bstates?\b|\bstatus\b/i.test(f.aspect)) return [];
  return f.value
    .split(/,|;|\/|→|->|\bor\b|\band\b|\bthen\b/i)
    .map((s) => s.replace(/[`*_"“”.()]/g, "").trim())
    .filter((s) => s.length > 1 && s.length < 40 && s.split(/\s+/).length <= 3);
}

const words = (s: string) => ` ${subjectKey(s)} `;

/** The action's own words that matter for matching: its verb and object,
 *  without the role or filler. */
function actionWords(action: string): string[] {
  return subjectKey(action)
    .split(" ")
    .filter((w) => w.length > 3);
}

/** Every action × state question, per entity with at least two states. */
export function obligations(facts: SpecModelFact[]): Obligation[] {
  const live = facts.filter((f) => f.status !== "superseded" && f.status !== "resolved");
  const states = new Map<string, Set<string>>();
  for (const f of live) for (const s of statesOf(f)) {
    const k = subjectKey(f.subject);
    (states.get(k) ?? states.set(k, new Set()).get(k)!).add(s);
  }
  const out: Obligation[] = [];
  for (const a of live.filter((f) => f.kind === "action")) {
    const entity = subjectKey(a.subject);
    const list = [...(states.get(entity) ?? [])];
    if (list.length < 2) continue;
    const verbs = actionWords(a.value);
    for (const state of list) {
      const st = subjectKey(state);
      const answer =
        live.find((f) => {
          if (f === a) return false;
          const w = words(`${f.text} ${f.value} ${f.aspect} ${f.source.quote ?? ""}`);
          return w.includes(` ${st} `) && verbs.some((v) => w.includes(` ${v}`)) && w.includes(` ${entity.split(" ").pop()}`);
        }) ?? null;
      out.push({
        key: `ob:${factKey({ kind: "action", subject: entity, aspect: a.aspect, text: `${a.value}|${st}`, source: { path: "", quote: `${a.value}|${st}` } })}`,
        entity: a.subject,
        role: a.aspect,
        action: a.value,
        state,
        answer,
        from: a,
      });
    }
  }
  return out;
}

/** An action or a scenario the documents describe that a confirmed rule
 *  forbids as written: the role is denied the action, or the rule allows it
 *  only to others (PRD fr-scenario-feasibility). The witness says both. */
export interface Blocked {
  fact: SpecModelFact;
  role: string;
  rule: ReadRule;
  witness: string;
}

/** A verb's stem: "edits", "edited", "editing" and "edit" read the same. */
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|e|s)$/, "") : w.replace(/s$/, ""));

/** The thing's head noun: "the approved request" is about a request. */
const head = (s: string) => subjectKey(s).split(" ").pop() ?? "";

/** Whether `who`, as the documents name it, is one of `roles`. */
function among(who: string, roles: string[]): boolean {
  const w = ` ${role(who)} `;
  return roles.some((r) => w.includes(` ${r} `) || ` ${r} `.includes(w));
}

/** Each action a role takes on a thing, and each scenario whose steps take
 *  it, checked against the confirmed permission rules about that thing and
 *  verb. Deterministic: only rules a member accepted are passed in, and a
 *  passage with no role named is not judged. */
export function blockedByRules(facts: SpecModelFact[], rules: ReadRule[]): Blocked[] {
  const perms = rules.filter((r) => r.reading?.form === "permission");
  if (perms.length === 0) return [];
  const live = facts.filter((f) => (f.kind === "action" || f.kind === "scenario") && f.status !== "superseded" && f.status !== "resolved");
  const out: Blocked[] = [];
  for (const f of live) {
    const who = f.aspect.trim();
    if (!who) continue;
    const said = subjectKey(f.kind === "action" ? `${f.value} ${f.subject}` : `${f.value} ${f.text}`).split(" ");
    const verbs = new Set(said.map(stem));
    for (const r of perms) {
      const p = r.reading as Extract<RuleForm, { form: "permission" }>;
      if (!verbs.has(stem(p.action))) continue;
      const thing = head(p.object);
      if (!thing || (f.kind === "action" ? head(f.subject) !== thing : !said.includes(thing))) continue;
      const named = among(who, p.roles);
      const forbidden = (p.deny && named) || (p.only && !p.deny && !named);
      if (!forbidden) continue;
      out.push({
        fact: f,
        role: who,
        rule: r,
        witness: `${f.kind === "scenario" ? `In “${f.subject}”, ` : ""}${who} ${f.kind === "action" ? f.value : `${p.action} ${p.object}`} — but ${describe(p)}`,
      });
    }
  }
  return out;
}
