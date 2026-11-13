// Tables for the System view: the running gears and the registered permissions,
// instead of a JSON dump / a bare id list.
import { useMemo } from "react";

import { DataTable } from "./data-table";

const TBL_CSS = `
.systbl-search { width: 100%; max-width: 340px; font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--background); color: var(--foreground); outline: none; margin-bottom: 10px; }
.systbl-search:focus { border-color: var(--primary); }
.systbl-scroll { max-height: 460px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
.systbl thead th { position: sticky; top: 0; z-index: 1; background: var(--card, var(--background)); }
.systbl tbody td { font-size: 13px; vertical-align: top; }
.systbl-name { font-weight: 550; }
.systbl-pills { display: flex; flex-wrap: wrap; gap: 4px; }
.systbl-pill { font-size: 11px; padding: 1px 7px; border: 1px solid var(--border); border-radius: var(--radius-full); color: var(--muted-foreground); white-space: nowrap; }
.systbl-mono { font-size: 11.5px; color: var(--muted-foreground); word-break: break-all; }
.systbl-desc { color: var(--muted-foreground); max-width: 520px; }
.systbl-muted { color: var(--muted-foreground); }
.systbl-badge { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-full); border: 1px solid var(--border); color: var(--muted-foreground); white-space: nowrap; }
.systbl-foot { margin-top: 8px; font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
`;

// ── Gears ──────────────────────────────────────────────────────────────────
interface Gear {
  name: string;
  capabilities?: string[];
  dependencies?: string[];
  deployment_mode?: string;
  instances?: unknown[];
}

export function GearsTable({ data }: { data: unknown }) {
  const gears = useMemo(() => {
    if (Array.isArray(data)) return data as Gear[];
    return ((data as { gears?: Gear[] } | undefined)?.gears ?? []) as Gear[];
  }, [data]);
  const err = (data as { error?: string } | undefined)?.error;
  const modes = [...new Set(gears.map((g) => g.deployment_mode ?? "—"))].sort();
  const pills = (items: string[] | undefined) => (
    <div className="systbl-pills">
      {(items ?? []).map((c) => (
        <span key={c} className="systbl-pill">
          {c}
        </span>
      ))}
      {(items ?? []).length === 0 && <span className="systbl-muted">—</span>}
    </div>
  );

  return (
    <div>
      <style>{TBL_CSS}</style>
      <DataTable<Gear>
        list="sys-gears"
        urlPrefix="gears."
        title="Gears"
        rows={gears}
        error={err ?? null}
        rowKey={(g) => g.name}
        rowLabel={(g) => g.name}
        search={{ placeholder: "Search gears, capabilities, deps…" }}
        searchText={(g) => [g.name, ...(g.capabilities ?? []), ...(g.dependencies ?? [])]}
        filters={[
          {
            id: "mode",
            allLabel: "Every deployment",
            options: modes.map((m) => ({ value: m, label: m.replace(/_/g, " ") })),
            match: (g, v) => (g.deployment_mode ?? "—") === v,
          },
        ]}
        empty={{ title: "No gears reported." }}
        columns={[
          { id: "name", header: "Gear", className: "systbl-name", compare: (a, b) => a.name.localeCompare(b.name), cell: (g) => g.name },
          { id: "caps", header: "Capabilities", cell: (g) => pills(g.capabilities) },
          { id: "deps", header: "Dependencies", cell: (g) => pills(g.dependencies) },
          {
            id: "mode",
            header: "Deployment",
            cell: (g) => <span className="systbl-badge">{(g.deployment_mode ?? "—").replace(/_/g, " ")}</span>,
          },
          {
            id: "instances",
            header: "Instances",
            num: true,
            compare: (a, b) => (a.instances ?? []).length - (b.instances ?? []).length,
            cell: (g) => (g.instances ?? []).length,
          },
        ]}
      />
    </div>
  );
}

// ── Permissions ─────────────────────────────────────────────────────────────
interface Entity {
  gts_id: string;
  content?: { display_name?: string; action?: string; resource_type?: string; description?: string };
}

const PERM_BASE = "gts.cf.toolkit.authz.permission.v1~";

export function PermissionsTable({ data }: { data: unknown }) {
  const rows = useMemo(() => {
    const list = (data as { entities?: Entity[] } | undefined)?.entities ?? [];
    return list
      // Instances only (the derived permissions), not the base type.
      .filter((e) => e.gts_id?.includes("authz.permission") && e.gts_id !== PERM_BASE)
      .map((e) => {
        const short = e.gts_id.replace(PERM_BASE, "");
        return {
          id: e.gts_id,
          short,
          name: e.content?.display_name || short.replace(/\.v\d+$/, "").replace(/[._]+/g, " ").trim(),
          action: e.content?.action ?? "",
          resource: (e.content?.resource_type ?? "").replace(/^gts\./, ""),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const actions = [...new Set(rows.map((r) => r.action).filter(Boolean))].sort();

  return (
    <div>
      <style>{TBL_CSS}</style>
      <DataTable<(typeof rows)[number]>
        list="sys-permissions"
        urlPrefix="perm."
        title="Permissions"
        rows={rows}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        search={{ placeholder: "Search permissions, actions, resources…" }}
        searchText={(r) => [r.name, r.short, r.action, r.resource]}
        filters={[
          {
            id: "action",
            allLabel: "Every action",
            options: actions.map((a) => ({ value: a, label: a })),
            match: (r, v) => r.action === v,
          },
        ]}
        empty={{ title: "No permission instances found in the types-registry." }}
        columns={[
          { id: "name", header: "Permission", className: "systbl-name", compare: (a, b) => a.name.localeCompare(b.name), cell: (r) => r.name },
          {
            id: "action",
            header: "Action",
            cell: (r) => (r.action ? <span className="systbl-badge">{r.action}</span> : <span className="systbl-muted">—</span>),
          },
          { id: "resource", header: "Resource", cell: (r) => <code className="systbl-mono" title={r.resource}>{r.resource || "—"}</code> },
          { id: "id", header: "Id", cell: (r) => <code className="systbl-mono" title={r.id}>{r.short}</code> },
        ]}
      />
    </div>
  );
}
