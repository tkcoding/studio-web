/* The /architecture/ page's block diagram and its doors for other platforms.
 * The model is `architecture-flow.ts`; this file only draws it. Gear chips are
 * the page's own, passed in, so choosing one opens the same detail panel. */

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  FLOW_DOORS,
  FLOW_STATE_WORDS,
  FLOW_STEPS,
  FLOW_ZONES,
  RESEARCH_PROPOSAL,
  nodeById,
  stepById,
  stepsThrough,
} from "./architecture-flow";
import type { FlowState } from "./architecture-flow";

function stepFromHash(): string | null {
  const m = window.location.hash.match(/^#step=(.+)$/);
  return m && stepById(decodeURIComponent(m[1])) ? decodeURIComponent(m[1]) : null;
}

function StateTag({ state }: { state: FlowState }) {
  return <span className={`arch-flow-state is-${state}`}>{FLOW_STATE_WORDS[state]}</span>;
}

export function FlowDiagram({
  renderGear,
  live,
}: {
  renderGear: (name: string) => ReactNode;
  /** What the running backend adds to a box, by box id. */
  live: Record<string, ReactNode>;
}) {
  const [stepId, setStepId] = useState<string | null>(stepFromHash);
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#step=")) setStepId(stepFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Choosing the chosen step again lets it go.
  const choose = useCallback((id: string) => {
    setStepId((prev) => {
      const next = prev === id ? null : id;
      history.replaceState(
        null,
        "",
        next ? `#step=${encodeURIComponent(next)}` : window.location.pathname + window.location.search,
      );
      return next;
    });
  }, []);

  const step = stepId ? stepById(stepId) : undefined;
  const lit = new Set(step?.nodes ?? []);

  return (
    <div className="arch-flow">
      <ol className="arch-flow-steps" aria-label="From specs to a running product">
        {FLOW_STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={`arch-flow-step${s.id === stepId ? " is-selected" : ""}${step && s.id !== stepId ? " is-dim" : ""}`}
              aria-pressed={s.id === stepId}
              data-step={s.id}
              onClick={() => choose(s.id)}
            >
              <span className="arch-flow-num">{i + 1}</span>
              <span className="arch-flow-step-title">{s.title}</span>
              {s.state !== "built" && <StateTag state={s.state} />}
            </button>
            {s.id === stepId && (
              <div className="arch-flow-step-body">
                <p>{s.does}</p>
                {s.gap && (
                  <p className={`arch-flow-gap is-${s.state}`}>
                    <strong>{s.state === "gap" ? "Not built: " : "Limit: "}</strong>
                    {s.gap}
                  </p>
                )}
                <p className="arch-flow-path arch-small">
                  {s.nodes.map((id, k) => (
                    <span key={id}>
                      {k > 0 && <span className="arch-muted"> → </span>}
                      {nodeById(id)?.title}
                    </span>
                  ))}
                </p>
                <span className="arch-chips">{s.gears.map((g) => <span key={g}>{renderGear(g)}</span>)}</span>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className={`arch-flow-board${step ? " has-step" : ""}`}>
        {FLOW_ZONES.map((zone) => (
          <section key={zone.id} className={`arch-flow-zone zone-${zone.id}`} aria-label={zone.title}>
            <header className="arch-flow-zone-head">
              <h3>{zone.title}</h3>
              <span className="arch-muted arch-small">{zone.where}</span>
            </header>
            <div className="arch-flow-nodes">
              {zone.nodes.map((node) => {
                const through = stepsThrough(node.id);
                const order = step ? step.nodes.indexOf(node.id) : -1;
                return (
                  <div
                    key={node.id}
                    className={`arch-flow-node${lit.has(node.id) ? " is-lit" : ""}`}
                    data-node={node.id}
                  >
                    <div className="arch-flow-node-top">
                      <strong>{node.title}</strong>
                      {order >= 0 ? (
                        <span className="arch-flow-order" title="Order in the chosen step">
                          {order + 1}
                        </span>
                      ) : (
                        <span className="arch-flow-through" aria-label={`Steps ${through.join(", ")}`}>
                          {through.map((n) => (
                            <button
                              key={n}
                              type="button"
                              className="arch-flow-mini"
                              title={FLOW_STEPS[n - 1].title}
                              onClick={() => choose(FLOW_STEPS[n - 1].id)}
                            >
                              {n}
                            </button>
                          ))}
                        </span>
                      )}
                    </div>
                    <p className="arch-small arch-muted">{node.detail}</p>
                    {live[node.id] && <p className="arch-small arch-flow-live">{live[node.id]}</p>}
                    {node.gears && (
                      <span className="arch-chips">{node.gears.map((g) => <span key={g}>{renderGear(g)}</span>)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <p className="arch-muted arch-small arch-flow-self">
          Studio ships itself the same way: <code>studio-delivery.yml</code> builds its images into ghcr.io, and a
          dispatched deploy runs <code>helm upgrade</code> of <code>deploy/helm/studio-web</code> into{" "}
          <code>studio-dev</code>.
        </p>
      </div>
    </div>
  );
}

export function FlowDoors() {
  return (
    <>
      <ul className="arch-doors">
        {FLOW_DOORS.map((d) => (
          <li key={d.id} className={`arch-door is-${d.state}`}>
            <div className="arch-flow-node-top">
              <strong>{d.title}</strong>
              <StateTag state={d.state} />
            </div>
            <p className="arch-small">{d.gives}</p>
            {d.paths.length > 0 && (
              <p className="arch-small">
                {d.paths.map((p, i) => (
                  <span key={p}>
                    {i > 0 && ", "}
                    <code>{p}</code>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <h3 className="arch-subtitle">For example, Research — a proposal, nothing of it is built</h3>
      <table className="arch-research">
        <thead>
          <tr>
            <th>What Research shows</th>
            <th>What it reads</th>
            <th>Through</th>
          </tr>
        </thead>
        <tbody>
          {RESEARCH_PROPOSAL.map((r) => (
            <tr key={r.title}>
              <td>{r.title}</td>
              <td className="arch-muted">{r.reads}</td>
              <td>{FLOW_DOORS.find((d) => d.id === r.door)?.title}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
