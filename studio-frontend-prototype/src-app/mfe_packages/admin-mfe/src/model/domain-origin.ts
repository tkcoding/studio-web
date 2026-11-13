// Moved from the prototype (src/domain-origin.ts, studio-frontend-poc/); one change: the `kit` origin (ADR-0067 §6,
// issue #1025), a type a kit brought, read from `meta.origin = "kit"` with the kit's slug and version.
// Where a domain type came from, and how it is tied to the others: what the
// model editor shows beside each type (ADR-0066). Pure, so it is tested
// without a server.

import { ancestorsOf, type DomainModel, type ModelEntity } from "./domain-runtime";

export type OriginKey = "studio" | "kit" | "gear" | "upload" | "organization" | "earlier";

export interface Origin {
  key: OriginKey;
  /** Short, for a badge. */
  label: string;
  /** One sentence: what it means for the type. */
  hint: string;
}

export const ORIGIN_ORDER: OriginKey[] = ["studio", "kit", "gear", "upload", "organization", "earlier"];

export const ORIGIN_TITLES: Record<OriginKey, string> = {
  studio: "Studio",
  kit: "Kits",
  gear: "Gears",
  upload: "Uploaded",
  organization: "Added here",
  earlier: "Earlier built-in",
};

/** Where `entity` came from: Studio's own model, a kit, a gear, an upload,
 *  this organization, or the model every organization used to start with.
 *  A kit comes first: a type a kit brings may still be held by a gear
 *  (issue #1025), and what the screen answers is who brought it. */
export function originOf(model: DomainModel, entity: ModelEntity): Origin {
  const meta = entity.meta ?? {};
  if (meta.origin === "kit") {
    const kit = meta.kit ? `${meta.kit}${meta.kit_version ? ` ${meta.kit_version}` : ""}` : "";
    return {
      key: "kit",
      label: kit ? `kit · ${kit}` : "kit",
      hint:
        `Brought by ${meta.kit ? `the kit ${meta.kit}` : "a kit"} installed in this organization: uninstalling it ` +
        `removes the type, unless objects of it are left.` +
        (meta.held_by ? ` ${meta.held_by} keeps its records.` : ""),
    };
  }
  if (meta.held_by || meta.origin === "gear") {
    return {
      key: "gear",
      label: `gear ${meta.held_by ?? meta.declared_by ?? ""}`.trim(),
      hint: meta.held_by
        ? `${meta.held_by} keeps these records: it writes its own fields, people fill in the ones added beside them.`
        : `${meta.declared_by ?? "A gear"} declares the storage requirements of this open type; this does not install its kit.`,
    };
  }
  if (model.studioTypes.has(entity.id) || meta.origin === "studio") {
    return {
      key: "studio",
      label: "Studio",
      hint: "Part of Studio's own model: every organization starts with it, and an upload never removes it.",
    };
  }
  if (meta.origin === "upload") {
    return {
      key: "upload",
      label: meta.upload ? `uploaded · ${meta.upload}` : "uploaded",
      hint: "Came with a domain model an administrator uploaded on top of Studio's.",
    };
  }
  if (meta.origin === "organization") {
    return { key: "organization", label: "added here", hint: "An administrator of this organization made it." };
  }
  return {
    key: "earlier",
    label: "earlier built-in",
    hint: "From the model every organization used to start with, before Studio kept to its own types.",
  };
}

const isRelation = (p: { extends?: string }) => p.extends === "edge" || p.extends === "link";
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The type a relation property points at, by id or name; null when the model has none. */
function targetId(model: DomainModel, p: { type?: string; relation?: string }): string | null {
  for (const want of [p.relation, p.type]) {
    const t = norm(want);
    if (!t) continue;
    const hit = model.entities.find((e) => norm(e.id) === t || norm(e.name) === t);
    if (hit) return hit.id;
  }
  return null;
}

export interface Link {
  /** The relation's field name on its source type. */
  name: string;
  /** What it says, read from the source: "includes", "uses"… */
  label: string;
  /** The other end. */
  other: string;
  /** Declared on a base of this type rather than on it. */
  inherited: boolean;
  /** The edge kind it is stored as (`owns`, `references`…). */
  kind?: string;
}

/** The relations `id` declares (its own and its bases'), and the ones other
 *  types declare to it. A relation to a type the model lacks is left out. */
export function linksOf(model: DomainModel, id: string): { out: Link[]; in: Link[] } {
  const chain = ancestorsOf(model, id);
  const out: Link[] = [];
  for (const owner of chain) {
    for (const p of model.byId.get(owner)?.properties ?? []) {
      if (!isRelation(p) || !p.name) continue;
      const other = targetId(model, p as { type?: string; relation?: string });
      if (!other) continue;
      out.push({ name: p.name, label: p.relationLabel || p.name, other, inherited: owner !== id, kind: p.relationType });
    }
  }
  const into: Link[] = [];
  const self = new Set([id]);
  for (const e of model.entities) {
    if (e.id === id) continue;
    for (const p of e.properties ?? []) {
      if (!isRelation(p) || !p.name) continue;
      const other = targetId(model, p as { type?: string; relation?: string });
      if (other && self.has(other))
        into.push({ name: p.name, label: p.relationLabel || p.name, other: e.id, inherited: false, kind: p.relationType });
    }
  }
  return { out, in: into };
}
