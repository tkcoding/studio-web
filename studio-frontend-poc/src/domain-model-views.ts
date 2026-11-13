// The Domain model tab's three views, each one person's question:
//
// - To resolve: can we build from these documents? A queue of what has to be
//   decided, most blocking first.
// - Model map: what is this application? Its entities, drawn as a graph of how
//   they connect.
// - Requirements: where does this come from, how far did it get? A
//   requirement followed from its passage to its code.
//
// Pure: domain-model-screens.tsx draws what these compute.

import {
  relatedEntities,
  subjectKey,
  type Entity,
  type RequirementTrace,
  type SpecModelFinding,
  type SpecModelSide,
  type SpecRequirement,
  type WorkItem,
} from "./spec-model";

// ── To resolve ──────────────────────────────────────────────────────────────

export type ResolveType = "finding" | "question" | "assumption" | "nobasis";

export interface ResolveItem {
  key: string;
  type: ResolveType;
  /** `bad` blocks a build; `warn` should be looked at. */
  tone: "bad" | "warn";
  title: string;
  /** What is wrong, and what to do about it, in a sentence. */
  hint: string;
  sides: SpecModelSide[];
  finding?: SpecModelFinding;
  requirement?: SpecRequirement;
  /** A finding a model proposed from facts nobody confirmed (a judged
   *  contradiction): a concern to look at, not a verdict, until a person
   *  says it is a real problem. */
  concern?: boolean;
  /** Decided already: shown after the rest, greyed. */
  done: boolean;
}

/** The kinds that say what to build, so a missing basis matters. An ADR or
 *  a component that states no source is not something to chase. */
const BUILDABLE = new Set(["fr", "nfr", "feature", "usecase", "constraint"]);

export const RESOLVE_LABEL: Record<ResolveType, string> = {
  finding: "Problem",
  question: "Open question",
  assumption: "Assumption",
  nobasis: "No basis",
};

/** A finding's message as a headline: a dangling reference reads as what is
 *  missing. */
export function findingTitle(f: SpecModelFinding): string {
  const m = /^(.+?) is cited, but the project has no (.+?)\.?$/.exec(f.message);
  return m ? `${m[1]} is cited, but there is no ${m[2]}` : f.message;
}

/** A finding the model judged from extracted facts rather than one a rule
 *  established on its own: the passages may disagree, a person decides. */
export const isConcern = (f: Pick<SpecModelFinding, "rule">) => f.rule.startsWith("contradiction.");

function findingHint(f: SpecModelFinding): string {
  if (f.rule.startsWith("reference.")) return "A document points at something that does not exist. Fix the reference, or write what it names.";
  if (isConcern(f))
    return "The model reads these passages as disagreeing. It is a proposed concern, not a verdict: say whether it is a real problem, then fix the document that is wrong.";
  return "The documents cannot all be right here. Decide which one is, and fix the others.";
}

/** Everything to decide, most blocking first: the documents' own problems,
 *  then open questions, assumptions, and buildable requirements that state no
 *  basis. A dismissed finding goes to the end. */
export function resolveQueue(findings: SpecModelFinding[], requirements: SpecRequirement[]): ResolveItem[] {
  const out: ResolveItem[] = [];
  const severity = (f: SpecModelFinding) => (f.severity === "high" ? 0 : f.severity === "medium" ? 1 : 2);
  for (const f of [...findings].sort((a, b) => severity(a) - severity(b))) {
    const concern = isConcern(f);
    out.push({
      key: `f:${f.fingerprint}`,
      type: "finding",
      tone: f.severity === "low" || (concern && f.decision !== "confirmed") ? "warn" : "bad",
      concern,
      title: findingTitle(f),
      hint: findingHint(f),
      sides: f.sides,
      finding: f,
      done: f.decision === "dismissed" || f.decision === "confirmed",
    });
  }
  const because = (r: SpecRequirement) => (r.because ? `: “${r.because}”` : "");
  for (const r of requirements.filter((r) => r.basis === "open_question")) {
    out.push({
      key: `q:${r.id}`,
      type: "question",
      tone: "bad",
      title: r.title ?? r.id,
      hint: `Left undecided${because(r)}. Someone has to answer it before it is built.`,
      sides: [r.defined_in],
      requirement: r,
      done: false,
    });
  }
  for (const r of requirements.filter((r) => r.basis === "assumption")) {
    out.push({
      key: `a:${r.id}`,
      type: "assumption",
      tone: "warn",
      title: r.title ?? r.id,
      hint: `Rests on an assumption${because(r)}. It may wait for a check; say how it will be checked, or cite what already shows it.`,
      sides: [r.defined_in],
      requirement: r,
      done: false,
    });
  }
  for (const r of requirements.filter((r) => r.basis === "stated" && BUILDABLE.has(r.kind ?? ""))) {
    out.push({
      key: `n:${r.id}`,
      type: "nobasis",
      tone: "warn",
      title: r.title ?? r.id,
      hint: "Says what to build, but not why or from where. Worth a source or the decision behind it; it does not stop a build.",
      sides: [r.defined_in],
      requirement: r,
      done: false,
    });
  }
  return [...out.filter((i) => !i.done), ...out.filter((i) => i.done)];
}

export interface Readiness {
  total: number;
  cited: number;
  reasoned: number;
  /** Things that wait for somebody. */
  open: number;
  /** Of them, the ones that stop a build. */
  blocking: number;
  ready: boolean;
}

/** Whether an item stops a build: a problem a rule established, a concern a
 *  person confirmed and nobody fixed yet, a question nobody answered. An
 *  assumption waiting for its check, a requirement that names no source and
 *  a concern nobody looked at are worth attention and stop nothing: a
 *  hypothesis is checked later, not before anyone may build. */
export function blocks(i: ResolveItem): boolean {
  if (i.type === "question") return !i.done;
  if (i.type !== "finding") return false;
  return i.concern ? i.finding?.decision === "confirmed" : !i.done;
}

/** How far the documents are from something one can build from. */
export function readiness(queue: ResolveItem[], byBasis: Partial<Record<string, number>>, total: number): Readiness {
  const open = queue.filter((i) => !i.done).length;
  const blocking = queue.filter(blocks).length;
  const cited = byBasis.cited ?? 0;
  const reasoned = byBasis.reasoned ?? 0;
  return { total, cited, reasoned, open, blocking, ready: blocking === 0 };
}

// ── Model map ───────────────────────────────────────────────────────────────

/** Where an entity is described most: the folder of most of its facts, two
 *  levels deep where there are three (`docs/adr`, `.github/agents`). */
export function entityArea(e: Pick<Entity, "facts">): string {
  const count = new Map<string, number>();
  for (const f of e.facts) {
    const parts = f.source.path.split("/");
    const area = parts.length > 2 ? parts.slice(0, 2).join("/") : parts.length > 1 ? parts[0] : "(root)";
    count.set(area, (count.get(area) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "(root)";
}

export interface MapEdge {
  from: string;
  to: string;
  /** A relation a document declares, or one entity's facts naming another. */
  kind: "relation" | "mentions";
  /** How many times. */
  n: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The map's lines: every declared relation, then every time one entity's
 *  facts name another (a name of four letters or more, as a whole word). One
 *  line per pair; a relation wins over a mention. */
export function mapEdges(entities: Entity[]): MapEdge[] {
  const edges = new Map<string, MapEdge>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (from: string, to: string, kind: MapEdge["kind"]) => {
    if (from === to) return;
    const id = pair(from, to);
    const had = edges.get(id);
    if (!had) edges.set(id, { from, to, kind, n: 1 });
    else {
      had.n++;
      if (kind === "relation") had.kind = "relation";
    }
  };
  for (const e of entities) for (const to of relatedEntities(e, entities)) add(e.key, to, "relation");
  const named = entities
    .filter((o) => o.name.length >= 4)
    .map((o) => ({ key: o.key, re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(o.name.toLowerCase())}s?(?=[^\\p{L}\\p{N}]|$)`, "u") }));
  for (const e of entities) {
    const text = e.facts.map((f) => `${f.text}\n${f.value}`).join("\n").toLowerCase();
    for (const o of named) if (o.key !== e.key && o.re.test(text)) add(e.key, o.key, "mentions");
  }
  return [...edges.values()];
}

/** The keys an entity connects to on the map. */
export function neighbours(key: string, edges: MapEdge[]): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.from === key) out.add(e.to);
    if (e.to === key) out.add(e.from);
  }
  return out;
}

export interface Placed {
  key: string;
  x: number;
  y: number;
}

/** A force layout (Fruchterman–Reingold) of the nodes inside `width` ×
 *  `height`: connected ones pulled together, all pushed apart, the start
 *  seeded so the same model is drawn the same way every time. */
export function layout(keys: string[], edges: MapEdge[], width: number, height: number, rounds = 220, pull = 0.25): Placed[] {
  const n = keys.length;
  if (n === 0) return [];
  const index = new Map(keys.map((k, i) => [k, i]));
  // A deterministic start: a sunflower spiral.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * Math.min(width, height) * 0.45;
    x[i] = width / 2 + r * Math.cos(i * golden);
    y[i] = height / 2 + r * Math.sin(i * golden);
  }
  const links: [number, number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined) links.push([a, b, e.kind === "relation" ? 2 : 1]);
  }
  const k = Math.sqrt((width * height) / n) * 0.6;
  let temp = Math.min(width, height) / 8;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let round = 0; round < rounds; round++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = x[i] - x[j];
        let ddy = y[i] - y[j];
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 0.01) {
          ddx = 0.1 * ((i % 7) - 3);
          ddy = 0.1 * ((j % 5) - 2);
          d2 = ddx * ddx + ddy * ddy + 0.01;
        }
        const f = (k * k) / d2;
        dx[i] += ddx * f;
        dy[i] += ddy * f;
        dx[j] -= ddx * f;
        dy[j] -= ddy * f;
      }
    }
    for (const [a, b, w] of links) {
      const ddx = x[a] - x[b];
      const ddy = y[a] - y[b];
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      // d²/k along the line: a link pulls as hard as two nodes push at k.
      const f = (d * w) / k;
      dx[a] -= ddx * f;
      dy[a] -= ddy * f;
      dx[b] += ddx * f;
      dy[b] += ddy * f;
    }
    for (let i = 0; i < n; i++) {
      // A pull to the middle, growing with the distance, keeps the loose
      // nodes (no link to hold them) on the page instead of on its edge.
      const gx = width / 2 - x[i];
      const gy = height / 2 - y[i];
      const g = (Math.sqrt(gx * gx + gy * gy) / k) * pull;
      dx[i] += gx * g;
      dy[i] += gy * g;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(d, temp);
      x[i] = Math.min(width - 12, Math.max(12, x[i] + (dx[i] / d) * step));
      y[i] = Math.min(height - 12, Math.max(12, y[i] + (dy[i] / d) * step));
    }
    temp *= 0.985;
  }
  return keys.map((key, i) => ({ key, x: x[i], y: y[i] }));
}

// ── Requirements ────────────────────────────────────────────────────────────

export type BlockToken =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "id"; v: string }
  | { t: "done" }
  | { t: "todo" }
  | { t: "priority"; v: string };

/** A requirement's block as written, as list items of tokens: `[x]` reads as
 *  done, `` `p1` `` as a priority, a backticked identifier as a link to it.
 *  The blocks arrive with their lines joined by ` - `. */
export function blockItems(text: string): BlockToken[][] {
  const items = text
    .split(/\s+-\s+(?=\S)/)
    .map((s) => s.replace(/^-\s+/, "").trim())
    .filter(Boolean);
  const tokenised = items.map((item) => {
    const out: BlockToken[] = [];
    const re = /\[x\]|\[ \]|`([^`]+)`/g;
    let at = 0;
    for (const m of item.matchAll(re)) {
      if (m.index! > at) out.push({ t: "text", v: item.slice(at, m.index) });
      if (m[0] === "[x]") out.push({ t: "done" });
      else if (m[0] === "[ ]") out.push({ t: "todo" });
      else if (/^cpt-[a-z0-9-]+$/.test(m[1])) out.push({ t: "id", v: m[1] });
      else if (/^p\d$/.test(m[1])) out.push({ t: "priority", v: m[1] });
      else out.push({ t: "code", v: m[1] });
      at = m.index! + m[0].length;
    }
    if (at < item.length) out.push({ t: "text", v: item.slice(at) });
    return out;
  });
  // `- [x] `p1` - `cpt-…`` is one line of the source: a marks-only item
  // belongs with the item after it.
  const marksOnly = (item: BlockToken[]) =>
    item.every((t) => t.t === "done" || t.t === "todo" || t.t === "priority" || (t.t === "text" && !t.v.trim()));
  const out: BlockToken[][] = [];
  let carry: BlockToken[] = [];
  for (const item of tokenised) {
    if (marksOnly(item)) {
      carry = [...carry, ...item.filter((t) => t.t !== "text"), { t: "text", v: " " }];
      continue;
    }
    out.push([...carry, ...item]);
    carry = [];
  }
  if (carry.length) out.push(carry.filter((t) => t.t !== "text"));
  return out;
}

export interface ChainStep {
  label: string;
  /** Reached: the chain holds here. */
  on: boolean;
  sides: SpecModelSide[];
  ids: string[];
  work: WorkItem[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A requirement from the passage that states it to the tests that check
 *  it: each step reached or not, so where the chain breaks shows. */
export function traceChain(r: SpecRequirement, trace: RequirementTrace | null, work: WorkItem[]): ChainStep[] {
  const docs = trace?.documents ?? [];
  const code = trace?.code ?? [];
  const tests = trace?.tests ?? [];
  const step = (on: boolean, label: string, rest: Partial<ChainStep> = {}): ChainStep => ({ label, on, sides: [], ids: [], work: [], ...rest });
  return [
    step(true, "Stated in", { sides: [r.defined_in] }),
    step(r.cites.length > 0, r.cites.length ? `Rests on ${plural(r.cites.length, "identifier")}` : "Rests on nothing it names", { ids: r.cites }),
    step(docs.length > 0, docs.length ? `Used by ${plural(docs.length, "document")}` : "No other document uses it", { sides: docs }),
    step(work.length > 0, work.length ? `Worked on in ${plural(work.length, "issue or PR", "issues and PRs")}` : "No issue or PR names it", { work }),
    step(code.length > 0, code.length ? `Named in the code: ${plural(code.length, "place")}` : trace ? "No code names it" : "The code is not read yet", { sides: code }),
    step(tests.length > 0, tests.length ? `Named by tests: ${plural(tests.length, "place")}` : "No test names it", { sides: tests }),
  ];
}

/** The requirements a search keeps: by basis, and by words in the id, title
 *  or text. */
export function findRequirements(items: SpecRequirement[], basis: string, text: string): SpecRequirement[] {
  const q = text.trim().toLowerCase();
  return items
    .filter((r) => basis === "all" || r.basis === basis)
    .filter((r) => !q || `${r.id} ${r.title ?? ""} ${r.text}`.toLowerCase().includes(q));
}

/** Entities whose name or facts hold the words, for the map's search. */
export function findEntities(entities: Entity[], text: string): Entity[] {
  const q = subjectKey(text);
  if (!q) return entities;
  return entities.filter((e) => e.keys.some((k) => k.includes(q)) || e.facts.some((f) => subjectKey(f.text).includes(q)));
}
