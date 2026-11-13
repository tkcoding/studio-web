/**
 * Build readiness, for the Components table: SPEC / SDK / IMPL.
 *
 * Two kinds of answer, kept apart because they disagree in practice:
 *
 * - **What the roadmap board says** -- the progress axes someone sets on the
 *   item (`roadmap_progress`: Design, SDK, Implementation, as percentages).
 * - **What the repository shows** -- the specs' ticked requirement markers
 *   (`progress`) and how many of their requirement IDs the code cites
 *   (`impl_trace`), both read by the scan.
 *
 * A board ahead of its repository is worth a flag rather than a quiet
 * average: "Implementation 90%" with the code citing a fifth of the
 * requirements is exactly the kind of number that should not be trusted
 * without a look.
 */

export type ReadinessAxis = "SPEC" | "SDK" | "IMPL";

export interface ReadinessBar {
  axis: ReadinessAxis;
  /** The board's own column name: "Design", "SDK", "Implementation". */
  label: string;
  /** Null for N/A on the board: not planned, which is not 0 %. */
  pct: number | null;
}

export interface ReadinessEvidence {
  axis: "SPEC" | "IMPL";
  text: string;
  pct: number;
}

export interface Readiness {
  bars: ReadinessBar[];
  evidence: ReadinessEvidence[];
  /** Where the board claims at least `GAP` points more than the repository shows. */
  gaps: string[];
}

/** How far ahead of the repository a board may be before it is flagged. */
export const GAP = 40;

type Values = Record<string, { b?: string; v?: string; n?: number; parts?: unknown } | null | undefined>;

function axisOf(label: string): ReadinessAxis | undefined {
  if (/design|spec/i.test(label)) return "SPEC";
  if (/sdk/i.test(label)) return "SDK";
  if (/impl|code/i.test(label)) return "IMPL";
  return undefined;
}

export function readinessOf(values: Values): Readiness | undefined {
  const parts = (values.roadmap_progress?.parts ?? []) as { label: string; pct: number | null }[];
  const bars: ReadinessBar[] = [];
  for (const p of Array.isArray(parts) ? parts : []) {
    const axis = axisOf(p.label);
    if (axis && !bars.some((b) => b.axis === axis)) bars.push({ axis, label: p.label, pct: p.pct });
  }
  bars.sort((a, b) => ORDER.indexOf(a.axis) - ORDER.indexOf(b.axis));

  const evidence: ReadinessEvidence[] = [];
  const spec = values.progress;
  if (spec && typeof spec.n === "number") evidence.push({ axis: "SPEC", text: `Specs: ${spec.b ?? `${spec.n}%`}`, pct: spec.n });
  const impl = values.impl_trace;
  if (impl && typeof impl.n === "number") evidence.push({ axis: "IMPL", text: `Code: ${impl.b ?? `${impl.n}%`}`, pct: impl.n });

  if (bars.length === 0 && evidence.length === 0) return undefined;

  const gaps: string[] = [];
  for (const e of evidence) {
    const bar = bars.find((b) => b.axis === e.axis);
    if (bar?.pct != null && bar.pct - e.pct >= GAP) {
      gaps.push(
        e.axis === "SPEC"
          ? `The board says ${bar.label} ${bar.pct}%, the specs have ${e.pct}% of their requirements ticked`
          : `The board says ${bar.label} ${bar.pct}%, the code cites ${e.pct}% of the requirements`,
      );
    }
  }
  return { bars, evidence, gaps };
}

const ORDER: ReadinessAxis[] = ["SPEC", "SDK", "IMPL"];
