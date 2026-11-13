/* The rules the prototype's Components screen kept inside its views
 * (components-catalog.tsx and component-registry.tsx at 00828880), taken out
 * unchanged so they are tested apart from the screens that draw them: the
 * field schema a type renders against, the lamps, a row's facts, the kit
 * nodes the registry adds, the one list of registry entries and catalogue
 * nodes, and the small formatters. The sentences stay English, as there. */

import type { CatalogNode, ComponentSource, FieldSchema, FieldVal, RegistryEntry, StudioKit } from "../api/types";
import { componentExcluded, componentKind } from "./component-kinds";
import { fieldTrend, type ComponentSnapshot, type FieldTrend } from "./field-trend";

// ── schema types ────────────────────────────────────────────────────────────

export type Kind = "text" | "label" | "docstate" | "bool" | "metric" | "status";
export type SourceClass = "repo" | "api" | "manual" | "none";
export type Lamp = "good" | "watch" | "bad" | "grey";

export interface Field {
  key: string;
  label: string;
  kind: Kind;
  lamp: boolean;
  source: { class: SourceClass; ref: string };
  example?: string;
  domain?: Record<string, unknown>;
}
export interface Group {
  id: string;
  title: string;
  icon: string;
  fields: Field[];
}
export interface Schema {
  groups: Group[];
  composition: { key: string; label: string; color: string }[];
  statusLegend: Record<string, string>;
  docStateLegend: Record<string, string>;
  sourceClasses: Record<string, { label: string; hint: string }>;
}

/** Every schema this tenant has, by the type it describes. */
export type Schemas = Record<string, Schema>;

export type Values = Record<string, FieldVal | null>;

/** What a page renders against when nothing describes its type: empty rather
 *  than invented. */
export const EMPTY_SCHEMA: Schema = {
  groups: [],
  composition: [],
  statusLegend: {},
  docStateLegend: {},
  sourceClasses: {},
};

export const GEAR_TYPE = "gts.cf.studio.catalog.gear.v1~";
/** The kit node type, as the backend registers it. */
export const KIT_TYPE = "gts.cf.studio.catalog.kit.v1~";

/** The presentation for one component type; a type with no schema of its own
 *  falls back to the gear schema. */
export function schemaFor(schemas: Schemas, typeId: string): Schema {
  return schemas[typeId] ?? schemas[GEAR_TYPE] ?? EMPTY_SCHEMA;
}

/** The served payload, keyed by the type each schema describes. */
export function indexSchemas(served: readonly FieldSchema[]): Schemas {
  const out: Schemas = {};
  for (const s of served) {
    if (s?.describes) out[s.describes] = s as unknown as Schema;
  }
  return out;
}

/** The types this organization treats as components. */
export function componentTypesOf(served: readonly FieldSchema[]): Set<string> {
  return new Set(served.filter((s) => s.component).map((s) => s.describes));
}

/** The newest non-yanked version that declares a licence. */
export function licenceFromVersions(rows: readonly CatalogNode[] | null): string | null {
  if (!rows) return null;
  const hit = rows.find((v) => !v.value.yanked && typeof v.value.license === "string" && v.value.license);
  return hit ? String(hit.value.license) : null;
}

// ── lamps ────────────────────────────────────────────────────────────────────

const LAMP_MAP: Record<string, Lamp> = { good: "good", watch: "watch", bad: "bad", none: "grey" };
const RANK: Record<Lamp, number> = { bad: 3, watch: 2, good: 1, grey: 0 };

export function lampOf(field: Field, values: Values): Lamp | null {
  if (!field.lamp) return null;
  const raw = values[field.key];
  if (!raw) return "grey";
  return LAMP_MAP[raw.s ?? "good"] ?? "good";
}

export function groupHealth(group: Group, values: Values) {
  const counts: Record<Lamp, number> = { good: 0, watch: 0, bad: 0, grey: 0 };
  let worst: Lamp | null = null;
  let n = 0;
  for (const f of group.fields) {
    const l = lampOf(f, values);
    if (!l) continue;
    n++;
    counts[l]++;
    if (worst === null || RANK[l] > RANK[worst]) worst = l;
  }
  return { counts, worst, n };
}

/** The groups with at least one answered field, each cut down to those fields. */
export function answeredGroups(schema: Schema, values: Values): Group[] {
  return schema.groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => values[f.key]) }))
    .filter((g) => g.fields.length > 0);
}

// ── small helpers ────────────────────────────────────────────────────────────

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function whenLabel(u: string | undefined): string {
  if (!u) return "";
  const [, m, d] = u.split("-");
  if (!m || !d) return "";
  return `${d} ${MON[+m - 1] ?? ""}`;
}
export function numText(n: unknown): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—";
}
export function dateText(s: unknown): string {
  if (typeof s !== "string" || !s) return "—";
  const dd = new Date(s);
  return Number.isNaN(dd.getTime()) ? "—" : dd.toISOString().slice(0, 10);
}
export function sizeText(n: unknown): string {
  if (typeof n !== "number") return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function publishedBy(pb: unknown): string {
  if (pb && typeof pb === "object") {
    const o = pb as Record<string, unknown>;
    return String(o.name ?? o.login ?? "—");
  }
  return typeof pb === "string" ? pb : "—";
}

/** Words a component name spells in capitals rather than in title case. */
const ACRONYMS = new Set(["api", "llm", "sdk", "oagw", "grpc", "bss", "oss", "http", "json", "ecb", "fx", "ai", "ui", "mfe", "id", "db"]);

/** `cf-gears-account-management` → `Account Management`. */
export function displayName(name: string): string {
  const bare = name.replace(/^cf-gears-/, "").replace(/^@[^/]+\//, "");
  return bare
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export const nameOf = (g: CatalogNode): string => String(g.value.name ?? g.instance_id);

/** A kit as a catalogue node: a kit IS a component. */
export function kitAsNode(kit: StudioKit): CatalogNode {
  return {
    type_id: KIT_TYPE,
    instance_id: `kit:${kit.slug}`,
    value: {
      tier: "platform",
      name: kit.slug,
      kind: "kit",
      description: kit.description,
      max_version: kit.default_version,
      newest_version: kit.default_version,
      repository: kit.repository_url || null,
      keywords: [kit.publisher, kit.visibility].filter(Boolean),
      categories: ["kit"],
    },
  };
}

/** The catalogue's nodes with the kit registry's built-ins: a synced kit wins,
 *  but takes the registry's description, repository and keywords where it has
 *  none; a built-in no sync found is added as a node of its own. */
export function withKits(nodes: readonly CatalogNode[], kits: readonly StudioKit[]): CatalogNode[] {
  const registry = new Map(kits.map((k) => [k.slug, k]));
  const synced = new Set(nodes.filter((n) => n.type_id === KIT_TYPE).map((n) => String(n.value.name ?? "")));
  const described = nodes.map((n) => {
    if (n.type_id !== KIT_TYPE) return n;
    const built = registry.get(String(n.value.name ?? ""));
    if (!built) return n;
    const value = { ...n.value };
    if (!String(value.description ?? "").trim()) value.description = built.description;
    if (!value.repository) value.repository = built.repository_url || null;
    if (!value.keywords?.length) value.keywords = [built.publisher, built.visibility].filter(Boolean) as string[];
    return { ...n, value };
  });
  return [...described, ...kits.filter((k) => !synced.has(k.slug)).map(kitAsNode)];
}

/** Each profile by the gear it describes. */
export function profilesByName(nodes: readonly CatalogNode[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    const name = typeof node.value.gear_name === "string" ? node.value.gear_name : "";
    if (name) out[name] = node.value as Record<string, unknown>;
  }
  return out;
}

/** The platform category the backend decided; the reconciled field only for
 *  a backend that does not classify yet. */
export function categoryOf(g: CatalogNode, resolvedCategory: string | undefined): string {
  return "component_kind" in g.value ? String(g.value.component_category ?? "") : String(resolvedCategory ?? "");
}

/** The categories present, for the category filter. */
export function categoriesOf(nodes: readonly CatalogNode[], resolvedCategory: (name: string) => string | undefined): string[] {
  const set = new Set<string>();
  for (const g of nodes) {
    if (componentExcluded(g) !== null) continue;
    const c = categoryOf(g, resolvedCategory(nameOf(g))).trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export type SortMode = "name-asc" | "name-desc" | "downloads-desc" | "downloads-asc";

/** Searched, narrowed and sorted as the catalogue's toolbar asks. */
export function filterCatalogue(
  nodes: readonly CatalogNode[],
  opts: {
    q: string;
    category: string;
    hideSdk: boolean;
    sort: SortMode;
    componentTypes: Set<string> | null;
    resolvedCategory: (name: string) => string | undefined;
  },
): CatalogNode[] {
  const needle = opts.q.trim().toLowerCase();
  const cat = opts.category.trim().toLowerCase();
  const rows = nodes
    .filter((g) => opts.componentTypes === null || opts.componentTypes.has(g.type_id))
    .filter((g) => !opts.hideSdk || componentKind(g) !== "sdk")
    .filter((g) => !cat || categoryOf(g, opts.resolvedCategory(nameOf(g))).toLowerCase().includes(cat))
    .filter((g) => {
      if (!needle) return true;
      const name = String(g.value.name ?? "").toLowerCase();
      const desc = String(g.value.description ?? "").toLowerCase();
      return name.includes(needle) || desc.includes(needle);
    });
  rows.sort((a, b) => {
    if (opts.sort === "downloads-desc" || opts.sort === "downloads-asc") {
      const d = Number(b.value.downloads ?? 0) - Number(a.value.downloads ?? 0);
      return opts.sort === "downloads-desc" ? d : -d;
    }
    const cmp = nameOf(a).localeCompare(nameOf(b));
    return opts.sort === "name-desc" ? -cmp : cmp;
  });
  return rows;
}

/** What one table row shows, worked out once per row. */
export interface RowFacts {
  values: Values;
  fields: Field[];
  trend: FieldTrend | undefined;
  pct: number;
  kind: string;
  category: string | null;
  kindReason: string | undefined;
  excluded: string | null;
  version: unknown;
  declared: unknown;
  bad: number;
  watch: number;
  repository: string | null;
  sources: ComponentSource[] | undefined;
}

export function rowFacts(
  gear: CatalogNode,
  values: Values,
  schema: Schema,
  baseline: ComponentSnapshot | undefined,
  sources: ComponentSource[] | undefined,
): RowFacts {
  const fields = schema.groups.flatMap((g) => g.fields);
  const trend = fieldTrend(fields, values, baseline);
  const filled = fields.filter((f) => values[f.key]).length;
  const pct = fields.length ? Math.round((filled / fields.length) * 100) : 0;
  const kind = componentKind(gear);
  const classified = "component_kind" in gear.value;
  const category = classified
    ? typeof gear.value.component_category === "string"
      ? gear.value.component_category
      : null
    : values.category?.b ?? null;
  const kindReason = typeof gear.value.component_kind_reason === "string" ? gear.value.component_kind_reason : undefined;
  const excluded = componentExcluded(gear);
  const released = gear.value.max_stable_version ?? gear.value.newest_version ?? null;
  // A FrontX package is not on crates.io: the version its package.json declares is the one people use.
  const declared = released ? null : values.version?.b ?? null;
  const version = released ?? declared;
  const lamps = fields.map((f) => lampOf(f, values)).filter((l): l is Lamp => !!l);
  const bad = lamps.filter((l) => l === "bad").length;
  const watch = lamps.filter((l) => l === "watch").length;
  // A component only a repository scan produced has no crates.io `repository`,
  // but the scan recorded where it read it.
  const scannedFrom = typeof gear.value.synced_from === "string" && gear.value.synced_from ? gear.value.synced_from : null;
  const repoPath = typeof gear.value.repo_path === "string" && gear.value.repo_path ? gear.value.repo_path : null;
  const repository =
    typeof gear.value.repository === "string" && gear.value.repository
      ? gear.value.repository
      : scannedFrom
        ? `https://github.com/${scannedFrom}${repoPath ? `/tree/HEAD/${repoPath}` : ""}`
        : null;
  return { values, fields, trend, pct, kind, category, kindReason, excluded, version, declared, bad, watch, repository, sources };
}

/** A new profile's starting point in the editor. */
export function defaultProfile(name: string): Record<string, unknown> {
  return {
    gear_name: name,
    values: {
      category: { v: "", b: "" },
      lifecycle: { v: "in development", b: "in development" },
      owner: { v: "", b: "", s: "grey", l: "" },
      coverage: { v: "", b: "", n: 0, s: "grey" },
    },
    diagram: null,
    uml: [],
  };
}

/** The editor's text as a profile, or why it is not one. */
export function parseProfile(draft: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(draft);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Profile must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

// ── one list: the registry and the catalogue ────────────────────────────────

/** One component as the list shows it: what a project declares (the registry
 *  entry), what was published (the catalogue node), or both. */
export interface ComponentRow {
  key: string;
  name: string;
  kind: string;
  description: string;
  /** The registry's state, or `published` for a catalogue node no project declares. */
  state: string;
  entry?: RegistryEntry;
  node?: CatalogNode;
}

/** The order a state filter offers them in: what needs a decision first. */
export const ROW_STATES = ["candidate", "declared", "registered", "published", "merged", "deprecated", "rejected", "extracted"];

/** Whether a catalogue node is this registry entry, published. */
export function sameComponent(e: Pick<RegistryEntry, "name" | "aliases" | "extraction">, nodeName: string): boolean {
  const n = nodeName.toLowerCase();
  const names = [e.name, ...(e.aliases ?? [])].map((x) => x.toLowerCase());
  return (
    names.includes(n) ||
    e.extraction?.crate_name?.toLowerCase() === n ||
    names.some((x) => n === `cf-gears-${x}` || n === `cf-${x}`)
  );
}

/** The registry's entries with the catalogue node each one is, and the
 *  catalogue's nodes no entry is, as rows of one list. */
export function componentRows(entries: readonly RegistryEntry[], catalogue: readonly CatalogNode[]): ComponentRow[] {
  const used = new Set<string>();
  const nodeName = (n: CatalogNode) => String(n.value.name ?? n.value.gear_name ?? n.instance_id);
  const rows: ComponentRow[] = entries.map((e) => {
    const node = catalogue.find((n) => !used.has(n.instance_id) && sameComponent(e, nodeName(n)));
    if (node) used.add(node.instance_id);
    return { key: `r:${e.name}`, name: e.name, kind: e.kind, description: e.description ?? "", state: e.state, entry: e, node };
  });
  for (const n of catalogue) {
    if (used.has(n.instance_id)) continue;
    rows.push({
      key: `c:${n.instance_id}`,
      name: nodeName(n),
      kind: String(n.value.kind ?? "component"),
      description: String(n.value.description ?? ""),
      state: "published",
      node: n,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** A row matches the search: its name, description or a path it is declared at. */
export function rowMatches(r: ComponentRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [r.name, r.description, ...(r.entry?.occurrences ?? []).map((o) => o.path)].some((s) =>
    s.toLowerCase().includes(needle),
  );
}

/** What a sync run shows while it runs and once it ends. */
export function syncLine(run: { state: string; progress?: string | null; summary?: string | null; last_error?: string | null; result?: Record<string, unknown> | null }): {
  done: boolean;
  ok: boolean;
  text: string;
} {
  const n = (key: string) => {
    const v = run.result?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const message = run.summary ?? run.last_error ?? run.progress ?? null;
  if (run.state === "succeeded") return { done: true, ok: true, text: `${n("gears")} gears · ${n("versions")} versions` };
  if (run.state === "failed" || run.state === "cancelled") return { done: true, ok: false, text: message || `sync ${run.state}` };
  const phase = (message || run.state).replace(/…$/, "");
  return { done: false, ok: true, text: `${phase} — ${n("gears")} gears · ${n("versions")} versions · ${n("stored")} in graph…` };
}
