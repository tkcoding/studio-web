// The model map in layers: what the specification is about (Domain), what
// serves it (System) and where that runs (Deployment), each drawn as a
// diagram of entity cards and the relations the documents declare.
//
// A layer is what the extractor stated on the entity's `entity` facts, the
// one most of them name. When none states one, it is read off the entity's
// name and where it is described: a name
// that says it is a screen, a gear or an API is System; one that says it is a
// cluster, an image or a pipeline, or a thing described almost only in
// deployment documents, is Deployment; the rest is the subject itself. Not
// every subject is an entity: an identifier (ADR-0007, cpt-…), a word used in
// passing, or anything a kit's template or example says is left out.
//
// Pure: domain-model-screens.tsx draws what these compute.

import { layout, type MapEdge } from "./domain-model-views";
import { subjectKey, type Entity, type SpecModelFact } from "./spec-model";

export type Layer = "domain" | "system" | "deployment";

export const LAYER_TITLE: Record<Layer, string> = {
  domain: "Domain",
  system: "System",
  deployment: "Deployment",
};

export const LAYER_WHAT: Record<Layer, string> = {
  domain: "what the product is about: organizations, projects, people, what they own and do",
  system: "what serves it: gears, sessions, screens, events, the IDE",
  deployment: "where it runs: clusters, images, pipelines, identity provider, databases",
};

/** A kit's templates and examples describe a document type, not this project. */
export const isTemplatePath = (p: string) => /\/templates\/|\/examples\/|\/template\.md$|kits\/sdlc\/artifacts/.test(p);
const isDeployPath = (p: string) => /^(deploy\/|keycloak\/|\.githooks\/|docs\/deploy)|\/k8s\//.test(p);
const SYSTEM_NAME =
  /\b(screen|tile|wizard|table|row|page|dialog|panel|button|view|card|tabs?|header|engine|backend|frontend|studio-[a-z-]+|[a-z]+-registry|gear|service|api|endpoint|route|mfe|microfrontend|shell|frame|event|topic|channel|schema|sdk|plugin|bridge|session|token|jwt|graph|storage|index|connector|driver|proxy|gateway|pdp|cache|queue|task|scheduler|ide|theia|portal|ui|component|module|kit|catalogue|catalog|contract|webhook|oidc|idp)\b/i;
const DEPLOY_NAME =
  /\b(k8s|kubernetes|helm|cluster|namespace|pod|keycloak|postgres|pg|cnpg|docker|compose|ci|cd|pipeline|workflow|image|ingress|secret|env|deploy|deployment|rollout|replica|volume|s3|bucket|dns|tls|certificate|vault|backup|hook|runner|ghcr|realm)\b/i;
const NOT_ENTITY = /^(adr[- ]?\d+|cpt-|https?:|\/|`)/i;

const LAYERS: Layer[] = ["domain", "system", "deployment"];

/** The layer most of the `entity` facts state (a tie goes to the earlier of
 *  domain, system, deployment), or null when none states one. */
function statedLayer(facts: SpecModelFact[]): Layer | null {
  const count = new Map<Layer, number>();
  for (const f of facts) {
    if (f.kind === "entity" && f.layer && LAYERS.includes(f.layer)) count.set(f.layer, (count.get(f.layer) ?? 0) + 1);
  }
  let best: Layer | null = null;
  for (const l of LAYERS) if ((count.get(l) ?? 0) > (best ? count.get(best)! : 0)) best = l;
  return best;
}

/** Which layer an entity belongs to, or null when it is not an entity of the
 *  product at all. Facts from a kit's templates do not count. */
export function layerOf(e: Pick<Entity, "name" | "facts">): Layer | null {
  if (NOT_ENTITY.test(e.name.trim())) return null;
  const facts = e.facts.filter((f) => !isTemplatePath(f.source.path));
  if (facts.length === 0) return null;
  // A word used in passing: nothing says what it is, and little about it.
  if (!facts.some((f) => f.kind === "entity") && facts.length < 3) return null;
  const stated = statedLayer(facts);
  if (stated) return stated;
  if (SYSTEM_NAME.test(e.name)) return "system";
  const deploy = facts.filter((f) => isDeployPath(f.source.path)).length;
  if (DEPLOY_NAME.test(e.name) || deploy > facts.length - deploy) return "deployment";
  return "domain";
}

/** How much a diagram wants to show an entity first: what the documents say
 *  of it, and above all how it relates. */
export function weight(e: Pick<Entity, "facts">): number {
  return e.facts.length + 6 * e.facts.filter((f) => f.kind === "relation").length;
}

/** The fields a card lists: what the entity holds, by aspect, once each. */
export function cardFields(e: Pick<Entity, "facts">, max = 4): string[] {
  const out: string[] = [];
  for (const f of e.facts) {
    if (f.kind !== "attribute" || !f.aspect.trim()) continue;
    const a = f.aspect.trim();
    if (!out.includes(a)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/** A card's size: wide enough for its name and fields, tall enough for them. */
export function cardSize(name: string, fields: string[]): { w: number; h: number } {
  const longest = Math.max(name.length, ...fields.map((f) => f.length + 2));
  return { w: Math.round(Math.min(230, Math.max(130, 18 + 7.2 * longest))), h: 30 + (fields.length ? 6 + 16 * fields.length : 0) };
}

/** The entity a relation fact points at: its value folded to an entity's key,
 *  or a longer phrase that starts or ends with one ("the owning workspace").
 *  Never the entity itself. */
export function relationTarget(e: Entity, f: SpecModelFact, entities: Entity[], byKey?: Map<string, Entity>): Entity | null {
  const tk = subjectKey(f.value);
  const target =
    (byKey ?? new Map(entities.map((x) => [x.key, x]))).get(tk) ??
    entities.find((o) => o.key !== e.key && o.key.length > 3 && (o.keys.includes(tk) || tk.startsWith(`${o.key} `) || tk.endsWith(` ${o.key}`)));
  return target && target.key !== e.key ? target : null;
}

/** A line of the diagram: a relation a document declares, with its verbs. */
export interface DiagramEdge extends MapEdge {
  verbs: string[];
}

/** The declared relations among `entities`, each with what the documents
 *  call it ("belongs to", "owns"), one line per pair. */
export function relationEdges(entities: Entity[]): DiagramEdge[] {
  const byKey = new Map(entities.map((e) => [e.key, e]));
  const out = new Map<string, DiagramEdge>();
  for (const e of entities) {
    for (const f of e.facts as SpecModelFact[]) {
      if (f.kind !== "relation") continue;
      const target = relationTarget(e, f, entities, byKey);
      if (!target) continue;
      const id = [e.key, target.key].sort().join("|");
      const had = out.get(id);
      const verb = f.aspect.trim();
      if (had) {
        had.n++;
        if (verb && !had.verbs.includes(verb)) had.verbs.push(verb);
      } else out.set(id, { from: e.key, to: target.key, kind: "relation", n: 1, verbs: verb ? [verb] : [] });
    }
  }
  return [...out.values()];
}

export interface Card {
  key: string;
  w: number;
  h: number;
}

export interface PlacedCard extends Card {
  x: number;
  y: number;
  /** In the row of cards no relation ties to the rest. */
  loose: boolean;
}

/** Cards placed for a diagram: the connected ones by the force layout, then
 *  pushed apart until no two overlap; the loose ones in rows beneath. The
 *  same model is placed the same way every time. */
export function placeCards(cards: Card[], edges: MapEdge[]): { cards: PlacedCard[]; width: number; height: number; looseTop: number | null } {
  if (cards.length === 0) return { cards: [], width: 0, height: 0, looseTop: null };
  const tied = new Set(edges.flatMap((e) => [e.from, e.to]));
  const connected = cards.filter((c) => tied.has(c.key));
  const loose = cards.filter((c) => !tied.has(c.key));
  // As wide as the frame is (about 3:2), roomy enough for cards, and pulled
  // to the middle only lightly so the drawing fills it rather than a column.
  const width = Math.max(900, Math.sqrt(connected.length) * 330);
  const pos = new Map(layout(connected.map((c) => c.key), edges, width, width / 1.45, 260, 0.06).map((p) => [p.key, { x: p.x, y: p.y }]));
  const placed: PlacedCard[] = connected.map((c) => ({ ...c, ...(pos.get(c.key) ?? { x: 0, y: 0 }), loose: false }));
  // Push overlapping cards apart along the axis they overlap least on.
  const gap = 24;
  for (let round = 0; round < 200; round++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = (a.x <= b.x ? -1 : 1) * (ox / 2 + 0.5);
          a.x += s;
          b.x -= s;
        } else {
          const s = (a.y <= b.y ? -1 : 1) * (oy / 2 + 0.5);
          a.y += s;
          b.y -= s;
        }
      }
    }
    if (!moved) break;
  }
  const minX = placed.length ? Math.min(...placed.map((c) => c.x - c.w / 2)) : 0;
  const maxX = placed.length ? Math.max(...placed.map((c) => c.x + c.w / 2)) : 1000;
  const bottom = placed.length ? Math.max(...placed.map((c) => c.y + c.h / 2)) : 0;
  let looseTop: number | null = null;
  if (loose.length) {
    const width = Math.max(1000, maxX - minX);
    looseTop = bottom + 70;
    let x = minX;
    let y = looseTop + 26;
    let row = 0;
    for (const c of loose) {
      if (x + c.w > minX + width && x > minX) {
        x = minX;
        y += row + gap;
        row = 0;
      }
      placed.push({ ...c, x: x + c.w / 2, y: y + c.h / 2, loose: true });
      x += c.w + gap;
      row = Math.max(row, c.h);
    }
  }
  const left = Math.min(...placed.map((c) => c.x - c.w / 2));
  const top = Math.min(...placed.map((c) => c.y - c.h / 2), looseTop ?? Infinity);
  // Shift so the drawing starts at the origin.
  for (const c of placed) {
    c.x -= left;
    c.y -= top;
  }
  return {
    cards: placed,
    width: Math.max(...placed.map((c) => c.x + c.w / 2)),
    height: Math.max(...placed.map((c) => c.y + c.h / 2)),
    looseTop: looseTop === null ? null : looseTop - top,
  };
}

/** An entity as the editor starts it: what the model already knows, each
 *  field and relation once, so a person corrects rather than retypes. */
export function entityDraft(e: Pick<Entity, "name" | "facts">): {
  name: string;
  definition: string;
  fields: { name: string; meaning: string }[];
  relations: { verb: string; target: string }[];
} {
  const fields: { name: string; meaning: string }[] = [];
  const relations: { verb: string; target: string }[] = [];
  for (const f of e.facts) {
    if (f.kind === "attribute" && f.aspect.trim() && !fields.some((x) => x.name === f.aspect.trim()))
      fields.push({ name: f.aspect.trim(), meaning: f.value.trim() });
    if (f.kind === "relation" && f.aspect.trim() && f.value.trim()) {
      const r = { verb: f.aspect.trim(), target: f.value.trim() };
      if (!relations.some((x) => x.verb === r.verb && x.target.toLowerCase() === r.target.toLowerCase())) relations.push(r);
    }
  }
  return { name: e.name, definition: e.facts.find((f) => f.kind === "entity")?.text ?? "", fields, relations };
}
