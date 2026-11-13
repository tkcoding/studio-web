// A scannable table of the registered GTS entities (types-registry/v1/entities)
// instead of a raw JSON dump: categorised by gts_id, searchable, filterable.
import { useMemo, useState } from "react";
import { DataTable } from "./data-table";
import { Modal } from "./modal";

interface Segment { vendor?: string; package?: string; namespace?: string; type_name?: string; ver_major?: number }
interface Entity {
  id: string;
  gts_id: string;
  segments?: Segment[];
  is_schema?: boolean;
  content?: { title?: string; description?: string } & Record<string, unknown>;
  description?: string;
}

const CATEGORIES = ["Domain type", "Graph type", "Tenant type", "Tenant metadata", "Permission", "Plugin", "Other"] as const;
type Category = (typeof CATEGORIES)[number];

const CAT_COLOR: Record<Category, string> = {
  "Domain type": "var(--avatar-mint)", "Graph type": "var(--avatar-pink)", "Tenant type": "var(--avatar-blue)",
  "Tenant metadata": "var(--avatar-turquoise)", Permission: "var(--avatar-yellow)", Plugin: "var(--avatar-purple)", Other: "var(--avatar-grey)",
};

function categoryOf(g: string): Category {
  if (g.startsWith("gts.cf.core.graph")) return "Graph type";
  if (g.startsWith("gts.cf.studio.domain")) return "Domain type";
  if (g.includes("authz.permission")) return "Permission";
  if (g.includes(".plugins.plugin.")) return "Plugin";
  if (g.includes("am.tenant_type")) return "Tenant type";
  if (g.includes("am.tenant_metadata")) return "Tenant metadata";
  return "Other";
}

function titleize(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayName(e: Entity): string {
  if (e.content?.title) return e.content.title;
  const last = e.segments?.[e.segments.length - 1]?.type_name;
  return last ? titleize(last) : e.gts_id;
}

/** The leaf `gts` id (the derived tail) without the family ancestry, for a shorter cell. */
function leafId(g: string): string {
  const parts = g.split("~").filter(Boolean);
  const tail = parts[parts.length - 1] ?? g;
  return tail.endsWith("~") ? tail : tail + "~";
}

export function GtsEntitiesTable({ data }: { data: unknown }) {
  const [sel, setSel] = useState<Entity | null>(null);

  
  const rows = useMemo(() => {
    const d = data as { entities?: Entity[]; error?: string } | undefined;
    const list = d?.entities ?? [];
    return list.map((e) => ({
      e,
      name: displayName(e),
      cat: categoryOf(e.gts_id),
      desc: e.content?.description ?? e.description ?? "",
    }));
  }, [data]);

  const err = (data as { error?: string } | undefined)?.error;
  type Row = (typeof rows)[number];

  return (
    <div className="gte">
      <style>{GTE_CSS}</style>
      <DataTable<Row>
        list="gts-entities"
        urlPrefix="gts."
        title="Registered entities"
        rows={rows}
        error={err ?? null}
        rowKey={(r) => r.e.id}
        rowLabel={(r) => r.name}
        onOpen={(r) => setSel(r.e)}
        search={{ placeholder: "Search types, ids, descriptions…" }}
        searchText={(r) => [r.e.gts_id, r.name, r.desc]}
        filters={[
          {
            id: "category",
            allLabel: "All",
            kind: "chips",
            options: CATEGORIES.filter((c) => rows.some((r) => r.cat === c)).map((c) => ({ value: c, label: c })),
            match: (r, v) => r.cat === v,
          },
        ]}
        empty={{ title: "No entities registered." }}
        columns={[
          { id: "name", header: "Name", className: "gte-name", compare: (x, y) => x.name.localeCompare(y.name), cell: (r) => r.name },
          {
            id: "category",
            header: "Category",
            compare: (x, y) => x.cat.localeCompare(y.cat),
            cell: (r) => (
              <span className="gte-badge" style={{ borderColor: CAT_COLOR[r.cat], color: CAT_COLOR[r.cat] }}>
                <span className="gte-dot" style={{ background: CAT_COLOR[r.cat] }} />
                {r.cat}
              </span>
            ),
          },
          { id: "type", header: "GTS type", cell: (r) => <code className="gte-id" title={r.e.gts_id}>{leafId(r.e.gts_id)}</code> },
          { id: "desc", header: "Description", className: "gte-desc", cell: (r) => r.desc || <span className="gte-muted">—</span> },
        ]}
      />

      {sel && (
        <Modal
          label={sel.gts_id}
          onClose={() => setSel(null)}
          backdropClassName="gte-modal"
          cardClassName="gte-dialog"
        >
            <button className="gte-close" aria-label="Close" onClick={() => setSel(null)}>×</button>
            <span className="gte-badge" style={{ borderColor: CAT_COLOR[categoryOf(sel.gts_id)], color: CAT_COLOR[categoryOf(sel.gts_id)] }}>
              <span className="gte-dot" style={{ background: CAT_COLOR[categoryOf(sel.gts_id)] }} />
              {categoryOf(sel.gts_id)}{sel.is_schema ? " · schema" : " · instance"}
            </span>
            <h3>{displayName(sel)}</h3>
            <code className="gte-id-full">{sel.gts_id}</code>
            {(sel.content?.description || sel.description) && (
              <p className="gte-modal-desc">{sel.content?.description || sel.description}</p>
            )}
            <h4>{sel.is_schema ? "Schema" : "Content"}</h4>
            <pre className="gte-json">{JSON.stringify(sel.content ?? {}, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

const GTE_CSS = `
.gte-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; }
.gte-search { flex: 1 1 220px; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--background); color: var(--foreground); outline: none; }
.gte-search:focus { border-color: var(--primary); }
.gte-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.gte-chip { font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--background); color: var(--muted-foreground); cursor: pointer; }
.gte-chip:hover { color: var(--foreground); }
.gte-chip.on { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.gte-chip.on .gte-c { color: var(--primary-foreground); }
.gte-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.gte-c { font-variant-numeric: tabular-nums; color: var(--muted-foreground); }
.gte-scroll { max-height: 460px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
.gte-table thead th { position: sticky; top: 0; z-index: 1; background: var(--card, var(--background)); }
.gte-table tbody td { font-size: 13px; }
.gte-name { font-weight: 550; }
.gte-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 2px 8px; border: 1px solid; border-radius: var(--radius-full); white-space: nowrap; }
.gte-id { font-size: 11.5px; color: var(--muted-foreground); word-break: break-all; }
.gte-desc { color: var(--muted-foreground); max-width: 420px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gte-muted { color: var(--muted-foreground); }
.gte-foot { margin-top: 8px; font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.gte-row { cursor: pointer; }
.gte-modal { position: fixed; inset: 0; z-index: 60; background: rgba(10,15,25,0.5); display: grid; place-items: center; padding: 20px; }
.gte-dialog { position: relative; width: min(720px, 100%); max-height: 85vh; overflow: auto; background: var(--card, var(--background)); border: 1px solid var(--border); border-radius: 14px; padding: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
.gte-close { position: absolute; top: 12px; right: 14px; border: none; background: none; font-size: 22px; line-height: 1; color: var(--muted-foreground); cursor: pointer; }
.gte-dialog h3 { margin: 8px 0 4px; font-size: 20px; }
.gte-id-full { font-size: 12px; color: var(--muted-foreground); word-break: break-all; }
.gte-modal-desc { font-size: 14px; line-height: 1.5; margin: 12px 0; }
.gte-dialog h4 { margin: 14px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); }
.gte-json { margin: 0; padding: 12px; border-radius: 10px; background: var(--background); border: 1px solid var(--border); font-size: 12px; line-height: 1.5; overflow: auto; max-height: 48vh; }
`;
