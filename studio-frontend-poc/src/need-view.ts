// The need and the hypotheses, read off the same facts as the domain model
// (PRDs "Describe the need" and "Validate product hypotheses"): who has which
// problem, what they want to reach, which ideas the materials mention, and
// which benefits someone expects from a solution. Nothing here invents a
// link: a problem with no idea, or an idea with no problem, is shown as the
// gap it is. Pure: discovery-screens.tsx draws what these compute.

import { subjectKey, type SpecModelFact } from "./spec-model";

export interface RoleNeeds {
  /** The role as the materials name it; "" when none is stated. */
  role: string;
  problems: SpecModelFact[];
  outcomes: SpecModelFact[];
  ideas: SpecModelFact[];
  scenarios: SpecModelFact[];
}

export interface NeedGap {
  kind: "problem-without-idea" | "idea-without-problem" | "role-without-problem";
  title: string;
  fact?: SpecModelFact;
}

const live = (f: SpecModelFact) => f.status !== "superseded" && f.status !== "resolved";

/** Each role with what the materials say it has and wants, the busiest
 *  first; what names no role is kept apart, never given one. */
export function needsByRole(facts: SpecModelFact[]): RoleNeeds[] {
  const by = new Map<string, RoleNeeds>();
  const of = (name: string) => {
    const key = subjectKey(name);
    const had = by.get(key);
    if (had) return had;
    const fresh: RoleNeeds = { role: name.trim(), problems: [], outcomes: [], ideas: [], scenarios: [] };
    by.set(key, fresh);
    return fresh;
  };
  for (const f of facts.filter(live)) {
    if (f.kind === "role") of(f.subject);
    else if (f.kind === "problem") of(f.aspect).problems.push(f);
    else if (f.kind === "outcome") of(f.aspect).outcomes.push(f);
    else if (f.kind === "idea") of(f.value).ideas.push(f);
    else if (f.kind === "scenario") of(f.aspect).scenarios.push(f);
  }
  const weight = (r: RoleNeeds) => r.problems.length + r.outcomes.length + r.ideas.length + r.scenarios.length;
  return [...by.values()].sort((a, b) => (a.role === "" ? 1 : b.role === "" ? -1 : weight(b) - weight(a)));
}

/** Where the need is thin: a problem nothing proposes to solve, an idea that
 *  names no problem, a role the materials give no problem. */
export function needGaps(facts: SpecModelFact[]): NeedGap[] {
  const live_ = facts.filter(live);
  const problems = live_.filter((f) => f.kind === "problem");
  const ideas = live_.filter((f) => f.kind === "idea");
  const requirements = live_.filter((f) => f.kind === "requirement");
  const words = (f: SpecModelFact) => ` ${subjectKey(`${f.subject} ${f.aspect} ${f.value} ${f.text}`)} `;
  const out: NeedGap[] = [];
  for (const p of problems) {
    const key = subjectKey(p.subject);
    const addressed = [...ideas, ...requirements].some((x) => key && words(x).includes(` ${key} `));
    if (!addressed) out.push({ kind: "problem-without-idea", title: `Nothing proposes to solve “${p.subject}”`, fact: p });
  }
  for (const i of ideas) {
    const target = subjectKey(i.aspect);
    if (!target || !problems.some((p) => subjectKey(p.subject) === target || words(p).includes(` ${target} `)))
      out.push({ kind: "idea-without-problem", title: `“${i.subject}” names no problem it solves`, fact: i });
  }
  for (const r of needsByRole(facts)) {
    if (r.role && r.problems.length === 0 && r.outcomes.length === 0)
      out.push({ kind: "role-without-problem", title: `The materials give ${r.role} no problem or goal` });
  }
  return out;
}

/** How a claim is checked: the five methods the PRD confirms, described in
 *  hypothesis-check.ts BUILTIN_METHODS; a kit may add more. */
export type CheckMethod = "problem" | "benefit" | "tco" | "demand" | "existing";

/** A first method for a claim, read from its words; a person changes it. */
export function proposeMethod(text: string): CheckMethod {
  const t = text.toLowerCase();
  if (/\b(time|seconds?|hours?|minutes?|days?|faster|quicker|cost|cheaper|save[sd]?|saving|tco|effort)\b/.test(t)) return "tco";
  if (/\b(demand|customers? (want|ask)|ask(ed)? for|requests?|wanted by)\b/.test(t)) return "demand";
  if (/\b(already|existing|currently|today)\b/.test(t)) return "existing";
  if (/\b(problem|pain|struggl\w*|difficult\w*|frustrat\w*|cannot|can't)\b/.test(t)) return "problem";
  return "benefit";
}

/** Where a hypothesis stands: nobody checked it, or what checking found. */
export type EvidenceState = "unchecked" | "supports" | "contradicts" | "insufficient";

export const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  unchecked: "Not checked",
  supports: "Supports",
  contradicts: "Contradicts",
  insufficient: "Insufficient",
};

export interface Hypothesis {
  fact: SpecModelFact;
  /** Which solution, for whom, with what effect: empty when unstated, never
   *  filled in. */
  solution: string;
  role: string;
  effect: string;
  method: CheckMethod;
}

/** Each benefit someone expects from a solution, as a hypothesis to check. */
export function hypothesesOf(facts: SpecModelFact[]): Hypothesis[] {
  return facts
    .filter((f) => f.kind === "benefit" && live(f))
    .map((f) => ({ fact: f, solution: f.subject.trim(), role: f.aspect.trim(), effect: f.value.trim(), method: proposeMethod(`${f.value} ${f.text}`) }));
}

/** The accepted need as a document, by role, each statement with where it
 *  was read: what docs/discovery.md says once a member accepts it. Only what
 *  was accepted is written; the model's other proposals stay proposals. */
export function needDocument(accepted: SpecModelFact[]): string {
  const src = (f: SpecModelFact) => `${f.source.path}${f.source.line_start ? `:${f.source.line_start}` : ""}`;
  const out = [
    "---",
    "type: material",
    "---",
    "",
    "# The need",
    "",
    "<!-- Accepted in Studio from the project's materials. Each line names where it was read. -->",
    "",
  ];
  for (const r of needsByRole(accepted)) {
    const sections: [string, SpecModelFact[]][] = [
      ["Problems", r.problems],
      ["Wants to reach", r.outcomes],
      ["Ideas", r.ideas],
      ["Scenarios", r.scenarios],
    ];
    if (!sections.some(([, l]) => l.length)) continue;
    out.push(`## ${r.role || "No role named"}`, "");
    for (const [title, list] of sections) {
      if (!list.length) continue;
      out.push(`### ${title}`, "");
      for (const f of list) out.push(`- **${f.subject}**${f.value ? ` — ${f.value}` : ""}. _(${src(f)})_`);
      out.push("");
    }
  }
  return out.join("\n");
}

/** A material as the built-in `material` document keeps it: what it is, then
 *  the text as it was given. */
export function materialDocument(title: string, content: string): string {
  return `# ${title}\n\n## Source\n\n${title}\n\n## Material\n\n${content}\n`;
}

/** The largest material one file may be: what a document holds. */
export const MATERIAL_MAX_BYTES = 512 * 1024;

const TEXT_FILE = /\.(md|markdown|txt|text|csv|tsv|json|html?|eml|vtt|srt|log|ya?ml)$/i;

/** A file someone dropped in, as a material, or why it is not taken: only
 *  text is read as it is, so a PDF or a Word file is refused with a word on
 *  what to do instead, never read as garbage. */
export function materialFromFile(name: string, size: number, text: string): { title: string; content: string } | { refused: string } {
  if (!TEXT_FILE.test(name)) return { refused: `${name}: only text files are read as they are (Markdown, plain text, CSV, HTML, e-mail, subtitles); paste the text of anything else` };
  if (size > MATERIAL_MAX_BYTES) return { refused: `${name}: larger than ${MATERIAL_MAX_BYTES / 1024} KiB; split it or paste the part that matters` };
  if (!text.trim()) return { refused: `${name}: empty` };
  if (text.includes("\u0000")) return { refused: `${name}: not text` };
  return { title: name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name, content: text };
}

/** Functional requirements that name no problem or goal the materials give,
 *  once the need is described at all: functionality nobody said why for.
 *  `requirements` are the identifiers the documents define, with their
 *  text. Nothing is asked of a project whose need is not described. */
export function unlinkedRequirements<R extends { id: string; title: string | null; text: string }>(requirements: R[], facts: SpecModelFact[]): R[] {
  const needs = facts.filter((f) => (f.kind === "problem" || f.kind === "outcome") && live(f));
  if (needs.length === 0) return [];
  const keys = needs.map((f) => subjectKey(f.subject)).filter((k) => k.length > 3);
  return requirements.filter((r) => {
    const said = ` ${subjectKey(`${r.title ?? ""} ${r.text}`)} `;
    return !keys.some((k) => said.includes(` ${k} `));
  });
}
