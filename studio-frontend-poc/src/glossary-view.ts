// The project's glossary, as a person works through it: what each word means,
// which two words are probably one thing, which words nobody has defined.
// Pure: glossary-screen.tsx draws what these compute.

import { layerOf, type Layer } from "./domain-layers";
import type { GlossaryDocRow } from "./api";
import type { Entity, GlossaryEntry, SpecModelFact } from "./spec-model";

export type GlossaryFilter = "all" | "undefined" | "similar" | "named";

/** One row of the glossary, with what the model knows of the word. */
export interface GlossaryRow {
  entry: GlossaryEntry;
  /** What the documents say it is, when one of them does. */
  definition: string | null;
  layer: Layer | null;
  /** Every passage that says what it is, each from its document: the one the
   *  definition is read from first. */
  definitions: SpecModelFact[];
  /** The documents it is said in. */
  paths: string[];
}

/** Each entry with its definition and layer, read off the model's entities. */
export function glossaryRows(entries: GlossaryEntry[], entities: Entity[]): GlossaryRow[] {
  const byKey = new Map<string, Entity>();
  for (const e of entities) for (const k of e.keys) byKey.set(k, e);
  return entries.map((entry) => {
    const e = byKey.get(entry.key);
    const definitions = e?.facts.filter((f) => f.kind === "entity") ?? [];
    const paths = [...new Set((e?.facts ?? []).map((f) => f.source.path))];
    return { entry, definition: definitions[0]?.text ?? null, layer: e ? layerOf(e) : null, definitions, paths };
  });
}

/** Two entries that are probably one thing, and why it looks so. */
export interface SimilarPair {
  a: GlossaryEntry;
  b: GlossaryEntry;
  why: string;
  /** How the names are alike: one is the other with an ending, or with a
   *  level in front. What a clarifying sentence says depends on it. */
  how?: { suffix: string } | { level: string };
}

/** A sentence that tells the two words apart, for the document that
 *  describes the longer one; a person corrects it before it is proposed. */
export function clarifySentence(p: SimilarPair): string {
  const [base, longer] = p.b.key.length >= p.a.key.length ? [p.a, p.b] : [p.b, p.a];
  const subject = longer.name.charAt(0).toUpperCase() + longer.name.slice(1);
  const article = /^[aeiou]/i.test(longer.name) ? "An" : "A";
  if (p.how && "level" in p.how) return `${subject} is a **${base.name}** at the ${p.how.level} level.`;
  if (p.how && p.how.suffix === "ship") return `${article} ${longer.name} is what makes someone a **${base.name}**.`;
  return `${subject} is not the same as **${base.name}**: …`;
}

const words = (key: string) => key.split(" ").filter(Boolean);
/** Levels a word can be qualified by without becoming another thing. */
// Not "studio": "studio-tasks" is a gear, not the task said more fully.
const SCOPES = new Set(["organization", "workspace", "project", "platform"]);

/** Pairs of entries that look like one thing under two names: one is the
 *  other with "-ship"/"-s"/"-ing" on it (member, membership), or one is the
 *  other with its level in front (membership, organization membership).
 *  Only entries the documents say something real about, the busiest first. */
export function similarPairs(entries: GlossaryEntry[], max = 40): SimilarPair[] {
  const pool = entries.filter((e) => e.facts >= 2 && e.key.length >= 4);
  // A pair a member said is two things is not offered again.
  const apart = (a: GlossaryEntry, b: GlossaryEntry) => !!a.distinct_from?.includes(b.key) || !!b.distinct_from?.includes(a.key);
  const byKey = new Map(pool.map((e) => [e.key, e]));
  const out: SimilarPair[] = [];
  const seen = new Set<string>();
  const add = (a: GlossaryEntry, b: GlossaryEntry, why: string, how: SimilarPair["how"]) => {
    const id = [a.key, b.key].sort().join("|");
    if (a.key === b.key || seen.has(id) || apart(a, b)) return;
    seen.add(id);
    out.push(a.facts >= b.facts ? { a, b, why, how } : { a: b, b: a, why, how });
  };
  for (const e of pool) {
    for (const suffix of ["ship", "s", "ing"]) {
      const other = byKey.get(e.key + suffix);
      if (other) add(e, other, `“${other.name}” is “${e.name}” with “-${suffix}”`, { suffix });
    }
    // "Organization membership" is the membership; "nested project" is a kind
    // of project, not another name for it. Only a level in front reads as the
    // same thing said more fully.
    const w = words(e.key);
    if (w.length === 2 && SCOPES.has(w[0])) {
      const tail = byKey.get(w[1]);
      if (tail) add(tail, e, `“${e.name}” names “${tail.name}” with its level`, { level: w[0] });
    }
  }
  return out.sort((x, y) => y.a.facts + y.b.facts - (x.a.facts + x.b.facts)).slice(0, max);
}

/** The rows a filter and a search keep, the most described first. */
export function filterRows(rows: GlossaryRow[], filter: GlossaryFilter, text: string, similar: SimilarPair[]): GlossaryRow[] {
  const q = text.trim().toLowerCase();
  const inPairs = new Set(similar.flatMap((p) => [p.a.key, p.b.key]));
  return rows
    .filter((r) => {
      if (filter === "undefined") return !r.definition && r.layer !== null;
      if (filter === "similar") return inPairs.has(r.entry.key);
      if (filter === "named") return r.entry.chosen || r.entry.aliases.length > 0;
      return true;
    })
    .filter((r) => !q || r.entry.name.toLowerCase().includes(q) || r.entry.spellings.some((s) => s.toLowerCase().includes(q)) || (r.definition ?? "").toLowerCase().includes(q))
    .sort((a, b) => b.entry.facts - a.entry.facts || a.entry.name.localeCompare(b.entry.name));
}

/** What to merge an entry into: the entries a search names, the busiest
 *  first, never itself or one already merged into it. */
export function mergeCandidates(entry: GlossaryEntry, entries: GlossaryEntry[], text: string, max = 8): GlossaryEntry[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const own = new Set([entry.key, ...entry.aliases.map((a) => a.key)]);
  return entries
    .filter((e) => !own.has(e.key) && (e.name.toLowerCase().includes(q) || e.spellings.some((s) => s.toLowerCase().includes(q))))
    .sort((a, b) => b.facts - a.facts)
    .slice(0, max);
}

/** A rename to offer to carry into the documents once `entry` is called
 *  `to`: from the name the documents use for it (a member's earlier choice is
 *  not in them), or null when that is the same word. */
export function renameOffer(entry: GlossaryEntry, to: string): { from: string; to: string } | null {
  const name = to.trim();
  if (!name) return null;
  const from = entry.chosen ? (entry.spellings.find((s) => s.toLowerCase() !== name.toLowerCase()) ?? entry.name) : entry.name;
  return from.toLowerCase() === name.toLowerCase() ? null : { from, to: name };
}

/** What to do with two names that look like one thing. */
export type PairAction = "same" | "clarify" | "different";

export interface PairVerdict {
  action: PairAction;
  /** Why, in a sentence a person can check against the evidence. */
  why: string;
  /** What the evidence is: how much each is said, where, and whether they meet. */
  evidence: { aFacts: number; bFacts: number; aDocs: number; bDocs: number; shared: number; aDefined: boolean; bDefined: boolean };
}

/** A recommendation for a pair, from how the names are alike and what the
 *  documents say of each. Never a decision: the person takes it or not.
 *  - "-ing" of the same word is the act and the thing done: one thing.
 *  - "-s" is a plural: one thing.
 *  - "-ship" names a standing, not the one who holds it (membership, member):
 *    two things worth telling apart in the documents.
 *  - A level in front with a definition of its own that says something else
 *    is a kind of the other: tell them apart. Without a definition of its own,
 *    said in the same documents, it is the other said more fully: one thing.
 *    "Different" is never guessed: a level in front names a kind. */
export function pairVerdict(p: SimilarPair, rowOf: (key: string) => GlossaryRow | undefined): PairVerdict {
  const a = rowOf(p.a.key);
  const b = rowOf(p.b.key);
  const aPaths = new Set(a?.paths ?? []);
  const shared = (b?.paths ?? []).filter((x) => aPaths.has(x)).length;
  const evidence = {
    aFacts: p.a.facts,
    bFacts: p.b.facts,
    aDocs: a?.paths.length ?? p.a.documents,
    bDocs: b?.paths.length ?? p.b.documents,
    shared,
    aDefined: !!a?.definitions.length,
    bDefined: !!b?.definitions.length,
  };
  const longer = p.b.key.length >= p.a.key.length ? { e: p.b, row: b, defined: evidence.bDefined } : { e: p.a, row: a, defined: evidence.aDefined };
  const base = longer.e === p.b ? { e: p.a, defined: evidence.aDefined } : { e: p.b, defined: evidence.bDefined };
  if (p.how && "suffix" in p.how) {
    if (p.how.suffix === "ing")
      return { action: "same", why: `“${longer.e.name}” is the act of “${base.e.name}”: one thing, named two ways.`, evidence };
    if (p.how.suffix === "s") return { action: "same", why: `“${longer.e.name}” is the plural of “${base.e.name}”.`, evidence };
    return {
      action: "clarify",
      why: `“${longer.e.name}” names the standing, “${base.e.name}” the one who holds it: two things the documents should tell apart.`,
      evidence,
    };
  }
  if (p.how && "level" in p.how) {
    if (longer.defined && base.defined)
      return {
        action: "clarify",
        why:
          shared === 0
            ? `Both are defined, never side by side: say where “${longer.e.name}” is defined that it is a kind of “${base.e.name}” at the ${p.how.level} level, or that it is not.`
            : `Both are defined: “${longer.e.name}” is a kind of “${base.e.name}” at the ${p.how.level} level — say so where it is defined.`,
        evidence,
      };
    if (!longer.defined && shared > 0)
      return { action: "same", why: `“${longer.e.name}” has no definition of its own and is said in ${shared} of the same documents: “${base.e.name}”, said more fully.`, evidence };
    return { action: "clarify", why: `“${longer.e.name}” is said apart from “${base.e.name}” and nothing defines how they differ: one sentence settles it.`, evidence };
  }
  return { action: "clarify", why: "The names are alike and nothing says how they differ.", evidence };
}

/** What the glossary document does with a term: keeps the row as written,
 *  fills what the row leaves out, or adds a term the documents name. */
export type DocChange = "kept" | "filled" | "added";

export interface PlannedRow {
  row: GlossaryDocRow;
  change: DocChange;
  /** What was filled in a kept row, in words. */
  filled: string[];
  /** How many facts the documents say of it: 0 for a term they never name. */
  facts: number;
}

/** A term folded for matching a written glossary against the model: case,
 *  an article and a plural do not make another term. */
export function foldTerm(s: string): string {
  let k = s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().replace(/^(the|a|an) /, "");
  if (k.length > 3 && k.endsWith("s") && !k.endsWith("ss")) k = k.slice(0, -1);
  return k;
}

/** A definition a glossary can carry: a sentence of five words or more, not
 *  a fragment ("served at /studio/{id}/") or a label. */
export function readsAsDefinition(text: string): boolean {
  return text.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w)).length >= 5;
}

/** The definition a new row takes: the one the person chose when it reads as
 *  a definition, else the fullest of the others that does. */
function definitionFor(r: GlossaryRow, chosen: SpecModelFact | null): SpecModelFact | null {
  if (chosen && readsAsDefinition(chosen.text)) return chosen;
  return [...r.definitions].filter((f) => readsAsDefinition(f.text)).sort((a, b) => b.text.length - a.text.length)[0] ?? null;
}

/** A name that is an identifier — `graph-storage`, `studio_documents`,
 *  `product.gdl` — names a thing in the code, not a term of the domain. */
export function isIdentifier(name: string): boolean {
  return /[_/.`]/.test(name) || /^[a-z0-9]+(-[a-z0-9]+)+$/.test(name);
}

/** A term as a glossary heads it: a name written all in lower case starts
 *  with a capital. */
export function termCase(name: string): string {
  return name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** The glossary to propose: every row the project already keeps, as written
 *  and in its order, with the other names and the terms-it-is-not the model
 *  knows filled in; then the terms the documents define and the glossary
 *  lacks — a domain term, defined, said at least `minFacts` times or settled
 *  by a member — the most said first, at most `maxAdded`, by name. */
export function planGlossary(
  existing: GlossaryDocRow[],
  rows: GlossaryRow[],
  defOf: (r: GlossaryRow) => SpecModelFact | null,
  opts: { minFacts?: number; maxAdded?: number; settled?: (r: GlossaryRow) => boolean } = {},
): PlannedRow[] {
  const { minFacts = 5, maxAdded = 40, settled = (r) => r.entry.chosen } = opts;
  const byFold = new Map<string, GlossaryRow>();
  const nameOf = new Map(rows.map((r) => [r.entry.key, r.entry.name]));
  for (const r of rows) {
    for (const n of [r.entry.key, r.entry.name, ...r.entry.spellings, ...r.entry.aliases.map((a) => a.name)]) {
      const k = foldTerm(n);
      if (!byFold.has(k)) byFold.set(k, r);
    }
  }
  const used = new Set<string>();
  const taken = new Set<string>();
  const sourceOf = (f: SpecModelFact) => `${f.source.path}${f.source.line_start ? `:${f.source.line_start}` : ""}`;
  const apartOf = (r: GlossaryRow) => (r.entry.distinct_from ?? []).map((k) => nameOf.get(k) ?? k);
  const out: PlannedRow[] = existing.map((e) => {
    for (const n of [e.term, ...e.aliases]) taken.add(foldTerm(n));
    const r = [e.term, ...e.aliases].map((n) => byFold.get(foldTerm(n))).find(Boolean);
    if (!r) return { row: e, change: "kept", filled: [], facts: 0 };
    used.add(r.entry.key);
    const filled: string[] = [];
    const row = { ...e, aliases: [...e.aliases], not_same_as: [...e.not_same_as] };
    const has = (list: string[], n: string) => list.some((x) => foldTerm(x) === foldTerm(n));
    for (const a of r.entry.aliases.map((x) => x.name)) {
      if (foldTerm(a) !== foldTerm(e.term) && !has(row.aliases, a)) {
        row.aliases.push(a);
        filled.push(`also written as “${a}”`);
      }
    }
    for (const n of apartOf(r)) {
      if (!has(row.not_same_as, n)) {
        row.not_same_as.push(n);
        filled.push(`not the same as “${n}”`);
      }
    }
    const def = definitionFor(r, defOf(r));
    if (!row.definition.trim() && def) {
      row.definition = def.text;
      row.source = sourceOf(def);
      filled.push("definition");
    }
    return { row, change: filled.length ? "filled" : "kept", filled, facts: r.entry.facts };
  });
  const added = rows
    .filter((r) => !used.has(r.entry.key) && !taken.has(foldTerm(r.entry.name)) && r.layer !== null && !isIdentifier(r.entry.name))
    .filter((r) => definitionFor(r, defOf(r)) && (r.entry.facts >= minFacts || settled(r)))
    .sort((a, b) => b.entry.facts - a.entry.facts)
    .slice(0, maxAdded)
    .map((r): PlannedRow => {
      const def = definitionFor(r, defOf(r))!;
      return {
        row: {
          term: termCase(r.entry.name),
          definition: def.text,
          aliases: r.entry.aliases.map((a) => a.name),
          not_same_as: apartOf(r),
          source: sourceOf(def),
        },
        change: "added",
        filled: [],
        facts: r.entry.facts,
      };
    })
    .sort((a, b) => a.row.term.localeCompare(b.row.term));
  return [...out, ...added];
}
