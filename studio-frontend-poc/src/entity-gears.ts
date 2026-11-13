// Which gear keeps each of the product's Domain entities: the one whose name
// is the entity's (studio-projects keeps Project), else the one whose display
// name or description names it (studio-user's "users, memberships and
// invitations" keeps Membership). An entity no gear keeps is a gap: a gear has
// to be made for it.
//
// Read from the engine's catalogue and the project's own gears (the plan's
// `project` candidates), with the words folded the way the model folds a
// subject (spec-model `subjectKey`), so "Projects" meets "project".
//
// Pure: domain-model-screens.tsx and product-configurator-view.tsx show it.

import type { Candidate } from "./api";
import { gearLabel } from "./product";
import { isPlugin, partLabel, type CatalogueIndex } from "./product-configurator";
import { subjectKey, type Entity } from "./spec-model";

/** A gear that could keep an entity, as much as the match reads. */
export interface GearRef {
  /** The engine id, or the project gear's name. */
  id: string;
  /** The name a product picks it by (its crate when that finds it). */
  name: string;
  /** Its crate, which names it too (`cf-gears-studio-projects`). */
  crate: string;
  label: string;
  /** What gear.gdl calls it, when it says; `label` falls back to the crate. */
  displayName: string | null;
  description: string | null;
  /** `project` for a gear the project's own repository declares. */
  origin: "catalogue" | "project";
}

/** The gear that keeps an entity, and why it is that one. */
export interface Keeper {
  gear: GearRef;
  why: string;
  /** 4 its whole name, 3 a word of its name, 2 its display name, 1 its description. */
  score: number;
}

export type EntityRef = Pick<Entity, "key" | "keys" | "name">;

/** Prefixes every gear's name carries: not what it is about. */
const PREFIX = /^(@[^/]+\/|cf-gears-|cf-|gears-|studio-)+/;
/** Words of a gear's name that say what kind of gear it is, not what it keeps:
 *  `account-management` keeps accounts, not management. */
const GENERIC = new Set([
  "api",
  "app",
  "core",
  "management",
  "manager",
  "service",
  "engine",
  "gateway",
  "registry",
  "resolver",
  "plugin",
  "provider",
  "sdk",
  "static",
  "client",
  "server",
  "mini",
  "tool",
  "kit",
  "common",
  "base",
  "store",
  "storage",
  "v1",
  "v2",
]);
/** A description match counts only while few gears say the word: one that
 *  half the catalogue says is not a hint of who keeps it. */
const MAX_DESCRIBERS = 3;

/** The gears an entity can be kept by: the catalogue's, plugins aside (a
 *  plugin serves its host's entities), and the project's own gears the
 *  catalogue does not list. */
export function gearRefs(index: CatalogueIndex | null, own: readonly Pick<Candidate, "name" | "origin">[] = []): GearRef[] {
  const out: GearRef[] = [];
  const seen = new Set<string>();
  for (const g of index?.gears ?? []) {
    if (isPlugin(g)) continue;
    out.push({ id: g.id, name: index!.name(g), crate: g.package.crate_name, label: partLabel(g), displayName: g.display_name?.trim() || null, description: g.description?.trim() || null, origin: "catalogue" });
    seen.add(g.id);
    seen.add(g.package.crate_name);
  }
  for (const c of own) {
    if (c.origin !== "project" || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ id: c.name, name: c.name, crate: c.name, label: gearLabel(c.name), displayName: null, description: null, origin: "project" });
  }
  return out;
}

/** A gear's name folded to what it is about: `cf-gears-studio-projects` → `project`. */
export function gearSubject(name: string): string {
  return subjectKey(name.replace(PREFIX, "").replace(/_/g, "-"));
}

/** What a gear's name can be about: folded as above, and with only the crate
 *  prefix taken off, so a gear drafted for "Studio session"
 *  (`cf-gears-studio-sessions`) is still that entity's and not "session"'s. */
export function gearSubjects(name: string): string[] {
  const crateOnly = subjectKey(name.replace(/^(@[^/]+\/)?(cf-gears-|cf-|gears-)*/, "").replace(/_/g, "-"));
  return [...new Set([gearSubject(name), crateOnly])];
}

const has = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

/** How well one gear matches one entity key, with the reason; null when it does not. */
function match(g: GearRef, key: string): Omit<Keeper, "gear"> | null {
  for (const n of new Set([g.id, g.crate])) {
    const subject = gearSubject(n);
    if (gearSubjects(n).includes(key)) return { score: 4, why: `its name is the entity's: ${gearLabel(n)}` };
    const words = subject.split(" ");
    if (!key.includes(" ") && words.includes(key) && !GENERIC.has(key))
      return { score: 3, why: `its name says it: ${gearLabel(n)}` };
  }
  if (g.displayName && has(subjectKey(g.displayName), key)) return { score: 2, why: `its display name says it: “${g.displayName}”` };
  if (g.description && has(subjectKey(g.description), key)) return { score: 1, why: `its description names it: “${g.description}”` };
  return null;
}

/** Each entity's keeper (or null: a gap), and each gear's entities, by gear id.
 *  The strongest match wins; among equals, the gear whose description names
 *  the entity first, then by id, so a model reads the same every time. */
export function entityGears(
  entities: readonly EntityRef[],
  gears: readonly GearRef[],
): { byEntity: Map<string, Keeper | null>; byGear: Map<string, EntityRef[]> } {
  const byEntity = new Map<string, Keeper | null>();
  const byGear = new Map<string, EntityRef[]>();
  for (const e of entities) {
    let best: (Keeper & { at: number }) | null = null;
    let describers = 0;
    for (const k of e.keys.length ? e.keys : [e.key]) {
      if (k.length < 3) continue;
      for (const g of gears) {
        const m = match(g, k);
        if (!m) continue;
        if (m.score === 1) describers++;
        const at = m.score === 1 ? ` ${subjectKey(g.description ?? "")} `.indexOf(` ${k} `) : 0;
        if (!best || m.score > best.score || (m.score === best.score && (at < best.at || (at === best.at && g.id < best.gear.id))))
          best = { gear: g, ...m, at };
      }
    }
    const keeper = best && (best.score > 1 || describers <= MAX_DESCRIBERS) ? { gear: best.gear, why: best.why, score: best.score } : null;
    byEntity.set(e.key, keeper);
    if (keeper) byGear.set(keeper.gear.id, [...(byGear.get(keeper.gear.id) ?? []), e]);
  }
  return { byEntity, byGear };
}
