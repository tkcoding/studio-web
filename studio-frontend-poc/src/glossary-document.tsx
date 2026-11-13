/* The project's glossary as a document of its repository (glossary-view.ts,
 * planGlossary): found and put in order when the documents keep one, created
 * when they do not, and proposed as docs/glossary.md in one pull request. */
import { useEffect, useMemo, useState } from "react";

import type { GlossaryDoc, GlossaryDocRow, SpecModelWrite } from "./api";
import { DataTable } from "./data-table";
import { planGlossary, type DocChange, type GlossaryRow, type PlannedRow } from "./glossary-view";
import type { SpecModelFact } from "./spec-model";

const CHANGE_LABEL: Record<DocChange, string> = { kept: "Kept as written", filled: "Filled", added: "Added" };

export function GlossaryDocument({
  rows,
  defOf,
  settled,
  load,
  propose,
}: {
  rows: GlossaryRow[];
  /** The definition a term goes by. */
  defOf: (r: GlossaryRow) => SpecModelFact | null;
  /** A term a member settled: its name or its definition. */
  settled: (r: GlossaryRow) => boolean;
  load: () => Promise<GlossaryDoc>;
  propose: (rows: GlossaryDocRow[]) => Promise<SpecModelWrite>;
}) {
  const [doc, setDoc] = useState<GlossaryDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SpecModelWrite | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && setDoc(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [load]);
  const plan = useMemo(
    () => (doc ? planGlossary(doc.found?.rows ?? [], rows, defOf, { settled }) : []),
    [doc, rows, defOf, settled],
  );
  if (error) return <p className="hint">The project&apos;s glossary could not be read: {error}</p>;
  if (!doc) return <p className="hint">Looking for the project&apos;s glossary…</p>;

  const found = doc.found;
  const n = (c: DocChange) => plan.filter((p) => p.change === c).length;
  const kept = plan.filter((p) => !left.has(p.row.term));
  const where = found ? (found.whole ? <code>{found.path}</code> : <><code>{found.path}</code>, “{found.heading}”</>) : null;

  return (
    <section className="card gl-doc" data-glossary-doc>
      <div className="gl-doc-head">
        <div>
          <div className="dm-h">The project&apos;s glossary</div>
          {found ? (
            <p>
              Kept in {where}: <b>{found.rows.length}</b> term{found.rows.length === 1 ? "" : "s"}.{" "}
              {!found.whole && <>It moves to <code>{doc.path}</code>, where every document can link a term; the section keeps its heading and links there. </>}
              The documents add <b>{n("added")}</b> term{n("added") === 1 ? "" : "s"}, and <b>{n("filled")}</b> row{n("filled") === 1 ? "" : "s"} get what they leave out.
            </p>
          ) : (
            <p>
              The project keeps no glossary. Studio can create <code>{doc.path}</code> from the <b>{n("added")}</b> terms its
              documents define and use most; every document then links a term there instead of saying again what it means.
            </p>
          )}
        </div>
        {!done && (
          <button type="button" className={open ? "ghost" : "primary"} onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : found ? "Put it in order" : "Create the glossary"}
          </button>
        )}
      </div>
      {done && (
        <p className="gl-doc-done">
          Proposed <code>{done.path}</code>:{" "}
          {done.pr_url ? (
            <a href={done.pr_url} target="_blank" rel="noreferrer">
              {done.pr_url}
            </a>
          ) : (
            <code>{done.branch}</code>
          )}
        </p>
      )}
      {open && !done && (
        <>
          <DataTable<PlannedRow>
            list="glossary-doc"
            urlPrefix="gd."
            rows={plan}
            rowKey={(p) => p.row.term}
            rowLabel={(p) => p.row.term}
            pageSize={15}
            empty={{ title: "No term to write." }}
            filters={[
              {
                id: "change",
                allLabel: "Every row",
                kind: "chips",
                options: (["kept", "filled", "added"] as DocChange[]).map((c) => ({ value: c, label: CHANGE_LABEL[c] })),
                match: (p, v) => p.change === v,
              },
            ]}
            columns={[
              {
                id: "term",
                header: "Term",
                compare: (a, b) => a.row.term.localeCompare(b.row.term),
                cell: (p) => (
                  <span className={left.has(p.row.term) ? "gl-doc-left" : undefined}>
                    <b>{p.row.term}</b>
                    {p.row.source && <div className="sub">{p.row.source}</div>}
                  </span>
                ),
              },
              { id: "def", header: "Definition", cell: (p) => <span className="sub gl-doc-def">{p.row.definition || "—"}</span> },
              { id: "aliases", header: "Also written as", cell: (p) => <span className="sub">{p.row.aliases.join(", ") || "—"}</span> },
              { id: "apart", header: "Not the same as", cell: (p) => <span className="sub">{p.row.not_same_as.join(", ") || "—"}</span> },
              {
                id: "change",
                header: "Change",
                cell: (p) =>
                  left.has(p.row.term) ? (
                    <span className="sub">left out</span>
                  ) : (
                    <span>
                      <span className={`dm-pill gl-doc-${p.change}`}>{CHANGE_LABEL[p.change]}</span>
                      {p.filled.length > 0 && <div className="sub">{p.filled.join("; ")}</div>}
                      {p.change === "added" && <div className="sub">said {p.facts} times</div>}
                    </span>
                  ),
              },
            ]}
            actions={(p) => [
              left.has(p.row.term)
                ? { label: "Put back", onSelect: () => setLeft((s) => { const t = new Set(s); t.delete(p.row.term); return t; }) }
                : { label: "Leave out", onSelect: () => setLeft((s) => new Set(s).add(p.row.term)) },
            ]}
          />
          <div className="dm-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || kept.length === 0}
              onClick={() => {
                setBusy(true);
                setError(null);
                propose(kept.map((p) => p.row))
                  .then(setDone)
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Proposing…" : `Propose ${kept.length} terms as a pull request`}
            </button>
            <span className="hint">
              {found && !found.whole ? `Writes ${doc.path} and links it from ${found.path}.` : `Writes ${doc.path}.`} Rows the project already keeps stay as written.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
