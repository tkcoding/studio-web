import type { CatalogNode } from "./api";

/* What a component is, as the backend decides it — and the ONE place this
 * page reads it from.
 *
 * `/components` lays the reference's classification onto each node
 * (`studio-backend/src/components_catalog/taxonomy.rs`): `component_kind`
 * from one vocabulary, `component_category` from the platform's categories,
 * and `component_excluded` — the reason — for what is not a component
 * (configs, test support, docs, templates, examples). Nodes that are older
 * copies of another never arrive.
 *
 * The type chips above the table and the table's rows both go through
 * `inKindFilter`, so the two cannot disagree: a chip's count is the number of
 * rows that clicking it shows. They used to be fed from two places (the
 * chips from each node's graph type, the column from the stored kind) and
 * said "Gear 105" over a table with thirty-five gears in it.
 *
 * A backend older than the classification sends none of the fields; the
 * stored `kind` is used then, as before. */

export const COMPONENT_KIND_LABELS: Record<string, string> = {
  gear: "gear",
  plugin: "plugin",
  sdk: "SDK",
  library: "library",
  "micro-frontend": "micro-frontend",
  "frontend-library": "frontend library",
  tool: "tool / CLI",
  kit: "kit",
  // A gear a roadmap board plans that no repository has yet.
  planned: "planned",
  config: "config",
  "test-support": "test support",
  docs: "docs",
  template: "template",
  example: "example",
};

/** The order the chips offer the component kinds in; others follow by name. */
const KIND_ORDER = ["gear", "planned", "plugin", "sdk", "library", "micro-frontend", "frontend-library", "tool", "kit"];

/** The filter value that shows what is not a component instead. */
export const NOT_COMPONENTS = "not-components";

const KIT_TYPE = "gts.cf.studio.catalog.kit.v1~";

export function componentKind(g: CatalogNode): string {
  const v = g.value as Record<string, unknown>;
  const k = v.component_kind ?? v.kind ?? (g.type_id === KIT_TYPE ? "kit" : "gear");
  return String(k);
}

/** Why a node is not a component, or null when it is one. */
export function componentExcluded(g: CatalogNode): string | null {
  const v = g.value as Record<string, unknown>;
  return typeof v.component_excluded === "string" ? v.component_excluded : null;
}

export function kindLabel(kind: string): string {
  return COMPONENT_KIND_LABELS[kind] ?? kind;
}

/** Whether a node passes a kind filter: `""` is every component, a kind is
 *  that kind, `NOT_COMPONENTS` is only what is not a component. */
export function inKindFilter(g: CatalogNode, filter: string): boolean {
  const excluded = componentExcluded(g) !== null;
  if (filter === NOT_COMPONENTS) return excluded;
  if (excluded) return false;
  return !filter || componentKind(g) === filter;
}

export interface KindChip {
  /** The filter value the chip sets. */
  value: string;
  label: string;
  count: number;
}

/** The chips for a list of nodes: "All" (every component), one per kind
 *  present, and the hidden non-components when there are any. Each count is
 *  `nodes.filter(n => inKindFilter(n, chip.value)).length` by construction. */
export function kindChips(nodes: readonly CatalogNode[]): KindChip[] {
  const counts = new Map<string, number>();
  let all = 0;
  let hidden = 0;
  for (const g of nodes) {
    if (componentExcluded(g) !== null) {
      hidden++;
      continue;
    }
    all++;
    const k = componentKind(g);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rank = (k: string) => {
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  const kinds = [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([k, n]) => ({ value: k, label: kindLabel(k), count: n }));
  const chips: KindChip[] = [{ value: "", label: "All", count: all }, ...kinds];
  if (hidden > 0) chips.push({ value: NOT_COMPONENTS, label: "Not components", count: hidden });
  return chips;
}

/** What the catalogue was actually filled from, read off the nodes: the
 *  repositories scans recorded (`synced_from`) and crates.io when any node
 *  carries registry figures. Not the source picker's saved state, which is a
 *  browser's preference for the NEXT sync and said "crates.io" over a
 *  catalogue three sources had filled. */
export function syncedSources(
  nodes: readonly CatalogNode[],
  profiles: Record<string, Record<string, unknown>> = {},
): string[] {
  const repos = new Set<string>();
  let crates = false;
  for (const g of nodes) {
    const v = g.value as Record<string, unknown>;
    if (typeof v.synced_from === "string" && v.synced_from) repos.add(v.synced_from.split("/").pop() ?? v.synced_from);
    if (typeof v.downloads === "number" || typeof v.max_version === "string") crates = true;
  }
  // A roadmap board leaves its name on each profile it planned
  // (`auto.roadmap_board`, written with the plan fields and cleared with
  // them), because readiness comes from there and not from the node.
  const boards = new Set<string>();
  for (const p of Object.values(profiles)) {
    const auto = p?.auto as Record<string, unknown> | undefined;
    const board = auto?.roadmap_board as { b?: unknown; v?: unknown } | undefined;
    const name = typeof board?.b === "string" && board.b ? board.b : typeof board?.v === "string" ? board.v : "";
    if (name) boards.add(name);
  }
  const out = [...repos].sort();
  if (crates) out.push("crates.io");
  for (const b of [...boards].sort()) out.push(`roadmap (${b})`);
  return out;
}
