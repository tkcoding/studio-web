// What a gear made for a capability keeps, read from the Domain model: the
// domain entities the capability is about, and the requirements about them
// that ask for it. A gear answers a capability and an entity lives inside one
// (so "Create a gear" starts from the capability, never from an entity); this
// is how the entities still reach the new gear's PRD.
//
// An entity belongs to the capability when the capability's words name it
// (its key, its vocabulary terms, the terms the documents used), when a
// requirement that implied the capability names it, or when one of its own
// requirements is such a requirement. Nothing is tuned to a project: the
// words are the capability's and the documents'.
//
// Pure: project-components-view.tsx shows it and hands it to the scaffold.

import type { PlanRow } from "./api";
import { entityDraft, layerOf } from "./domain-layers";
import type { CatalogueIndex } from "./product-configurator";
import { subjectKey, type Entity, type SpecModelSide } from "./spec-model";

/** One entity the gear keeps, and why it is this gear's. */
export interface KeptEntity {
  key: string;
  name: string;
  /** What it stores, by attribute name. */
  fields: string[];
  why: string;
  /** 3 the capability's words name it, 2 a requirement that asks for the capability does, 1 one of its requirements is one. */
  score: number;
}

/** A requirement the gear answers, with where the documents say it. */
export interface KeptRequirement {
  text: string;
  source: SpecModelSide | null;
}

/** How many entities and requirements the PRD spells out: a start, not the model. */
const MAX_ENTITIES = 6;
const MAX_FIELDS = 5;
const MAX_REQUIREMENTS = 6;

const has = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);
/** A requirement's sentence, so the documents' text and the plan's quote meet. */
const said = (s: string) => subjectKey(s.replace(/[“”"«»]/g, ""));

/** The capability's own words, folded: its key, its vocabulary terms and the
 *  terms the documents that ask for it used. */
export function capabilityWords(row: Pick<PlanRow, "capability" | "label" | "terms" | "sources">): string[] {
  const words = [row.capability.replace(/[-_.]+/g, " "), row.label ?? "", ...(row.terms ?? [])];
  for (const s of row.sources ?? []) words.push(...(s.terms ?? []));
  return [...new Set(words.map(subjectKey).filter((w) => w.length >= 3))];
}

/** The requirements that implied the capability, as the documents put them. */
function askedBy(row: Pick<PlanRow, "sources">): string[] {
  return [...new Set((row.sources ?? []).flatMap((s) => s.because ?? []).map((b) => b.trim()).filter(Boolean))];
}

/** The domain entities a gear for this capability keeps, the closest first,
 *  and the requirements about them that ask for it. */
export function capabilityEntities(
  row: Pick<PlanRow, "capability" | "label" | "terms" | "sources">,
  entities: readonly Entity[],
): { entities: KeptEntity[]; requirements: KeptRequirement[] } {
  const words = capabilityWords(row);
  const asked = askedBy(row);
  const askedSaid = asked.map(said);
  const kept: (KeptEntity & { entity: Entity })[] = [];
  for (const e of entities) {
    if (layerOf(e) !== "domain") continue;
    const keys = (e.keys.length ? e.keys : [e.key]).filter((k) => k.length >= 3);
    let found: Pick<KeptEntity, "why" | "score"> | null = null;
    // Either way round: "invoice management" names Invoice, and Invoice line is invoicing's too.
    const word = words.find((w) => keys.some((k) => has(w, k) || has(k, w)));
    if (word) found = { score: 3, why: `the capability's words name it: “${word}”` };
    if (!found) {
      const at = askedSaid.findIndex((s) => keys.some((k) => has(s, k)));
      if (at >= 0) found = { score: 2, why: `a requirement that asks for the capability names it: “${asked[at]}”` };
    }
    if (!found) {
      const own = e.facts.find((f) => f.kind === "requirement" && askedSaid.includes(said(f.text)));
      if (own) found = { score: 1, why: `its requirement asks for the capability: “${own.text}”` };
    }
    if (!found) continue;
    kept.push({ entity: e, key: e.key, name: e.name, fields: entityDraft(e).fields.slice(0, MAX_FIELDS).map((f) => f.name), ...found });
  }
  // The closest first; among equals, the most described, then by name, so it reads the same every time.
  kept.sort((a, b) => b.score - a.score || b.entity.facts.length - a.entity.facts.length || a.name.localeCompare(b.name));
  const picked = kept.slice(0, MAX_ENTITIES);

  // The requirements: first the ones the documents gave as asking for the
  // capability, with their place when an entity's facts hold them; then the
  // picked entities' own requirements that use the capability's words.
  const requirements: KeptRequirement[] = [];
  const seen = new Set<string>();
  const add = (text: string, source: SpecModelSide | null) => {
    const k = said(text);
    if (!k || seen.has(k) || requirements.length >= MAX_REQUIREMENTS) return;
    seen.add(k);
    requirements.push({ text: text.trim(), source });
  };
  const facts = picked.flatMap((k) => k.entity.facts.filter((f) => f.kind === "requirement"));
  for (let i = 0; i < asked.length; i++) {
    const fact = facts.find((f) => said(f.text) === askedSaid[i]);
    add(asked[i], fact?.source ?? null);
  }
  for (const f of facts) if (words.some((w) => has(said(f.text), w))) add(f.text, f.source);

  return { entities: picked.map((k) => ({ key: k.key, name: k.name, fields: k.fields, why: k.why, score: k.score })), requirements };
}

/** The category (gear.gdl's subsystem) a gear for this capability most likely
 *  belongs to: the one most of the catalogue's candidates for the capability
 *  sit in, else the one most of the gears keeping the kept entities' related
 *  entities sit in. Examples never count. Null when nothing says: the server
 *  then writes `platform`. */
export function suggestedCategory(
  row: Pick<PlanRow, "candidates">,
  kept: readonly Pick<KeptEntity, "key">[],
  entities: readonly Entity[],
  index: Pick<CatalogueIndex, "find"> | null,
  keeperOf: (keys: string[]) => (string | null)[],
): { category: string; why: string } | null {
  if (!index) return null;
  const most = (names: (string | null)[], why: string) => {
    const count = new Map<string, number>();
    for (const n of names) {
      const c = n ? index.find(n)?.category?.trim() : null;
      if (c && c !== "example") count.set(c, (count.get(c) ?? 0) + 1);
    }
    const best = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return best ? { category: best[0], why } : null;
  };
  const byCandidates = most(
    (row.candidates ?? []).map((c) => c.name),
    "where the catalogue's gears that come close to the capability sit",
  );
  if (byCandidates) return byCandidates;
  const keptKeys = new Set(kept.map((k) => k.key));
  const related = new Set<string>();
  for (const e of entities) {
    if (!keptKeys.has(e.key)) continue;
    for (const r of entityDraft(e).relations) {
      const k = subjectKey(r.target);
      if (k && !keptKeys.has(k)) related.add(k);
    }
  }
  return most(keeperOf([...related]), "where the gears keeping the entities it relates to sit");
}

/** "a, b and c". */
function listed(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What the PRD adds to the capability's opening sentence: the entities the
 *  gear keeps and the requirements it answers. The scaffold has no field for
 *  either, so they are said in words: the session agent that fills the
 *  skeleton reads them there. Empty when the Domain model says nothing. */
export function keptSentences(found: { entities: readonly KeptEntity[]; requirements: readonly KeptRequirement[] }): string {
  const parts: string[] = [];
  if (found.entities.length)
    parts.push(
      `It keeps ${listed(found.entities.map((e) => (e.fields.length ? `${e.name} (${e.fields.join(", ")})` : e.name)))}.`,
    );
  if (found.requirements.length)
    parts.push(`The requirements it answers: ${found.requirements.map((r) => `“${r.text.replace(/[.\s]+$/, "")}”`).join("; ")}.`);
  return parts.join(" ");
}
