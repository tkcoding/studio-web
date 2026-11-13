import { useEffect, useState } from "react";
import { api } from "./api";
import type { GearActivity, GearPullRequests } from "./api";
import { errText } from "./format";

export type { GearActivity, GearPullRequests } from "./api";

/* ============================================================================
 * Delivery activity per Gear, from Constructor Insight.
 *
 * The rules that make this possible are NOT here any more. Insight keys its git
 * metrics by *repository*; a gear is a directory inside one
 * (`gears/system/api-gateway/…` in `constructorfabric/gears-rust`), so
 * somebody has to group the catalogue by repository, name the directory each
 * crate publishes from, resolve the collisions and join the two answers back
 * together per gear. That used to happen here, which also meant the whole
 * component catalogue and every delivery profile were fetched into the page in
 * order to be grouped. It lives in `components_catalog::activity` now, behind
 * `GET /studio-components-catalog/v1/activity`, so a second portal does not
 * grow its own copy of it.
 *
 * What is still here is the drawing: the charts, the tiles and the wording.
 *
 * Two caveats the panel has to keep repeating, because they are about the
 * numbers rather than the pictures. A pull request belongs to a repository, so
 * it is *attributed* through the files its commits touched — dependable for
 * what merged (~97% reach their files), only indicative for what was abandoned
 * (~29% of closed, ~46% of open) — and one touching three gears counts in all
 * three, so the rows do not partition the repository. CI is not here and
 * cannot be: a pipeline run names a commit, not a file.
 * ==========================================================================*/

export interface ActivityIndex {
  status: "off" | "loading" | "ready" | "error";
  /** Present when `status === "error"` — the message is shown, not swallowed. */
  error?: string;
  /** The window Insight actually used. */
  from?: string;
  to?: string;
  byGear: Map<string, GearActivity>;
  /** True when Insight capped a page: the ranking is a prefix. */
  truncated: boolean;
}

const EMPTY: ActivityIndex = {
  status: "off",
  byGear: new Map(),
  truncated: false,
};

/** Windows offered in the UI. */
export const ACTIVITY_WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
] as const;

/**
 * Load per-gear activity over the selected window.
 *
 * Keyed on the window alone: the server reads the catalogue, so re-rendering
 * the list (a filter, a profile edit) does not re-query anything.
 */
export function useGearActivity(token: string, days: number): ActivityIndex {
  const [state, setState] = useState<ActivityIndex>(EMPTY);

  useEffect(() => {
    if (!token) {
      setState(EMPTY);
      return;
    }
    let live = true;
    setState((cur) => ({ ...cur, status: "loading" }));
    api
      .gearActivity(token, days, true)
      .then((page) => {
        if (!live) return;
        setState({
          status: "ready",
          from: page.sources.from ?? undefined,
          to: page.sources.to ?? undefined,
          byGear: new Map(page.items.map((row) => [row.gear, row])),
          truncated: page.sources.truncated,
        });
      })
      .catch((e) => {
        if (live) setState({ ...EMPTY, status: "error", error: errText(e) });
      });
    return () => {
      live = false;
    };
  }, [token, days]);

  return state;
}

// ── formatting ───────────────────────────────────────────────────────────────

/** 1,284 · 12.9K · 1.2M — a stat tile's value, never a raw 1284000. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ── the chart ────────────────────────────────────────────────────────────────

/**
 * Weekly change: lines added above the zero rule, lines removed below it.
 *
 * One scale for both arms — same unit, opposite sign — so the two halves are
 * comparable by eye. A diverging blue/red pair carries the polarity (validated
 * for contrast and colour-vision separation in both themes); the legend and the
 * tooltip carry identity, so nothing depends on telling the two hues apart.
 */
export function ChurnChart({ points, label }: { points: GearActivity["points"]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const scale = Math.max(1, ...points.map((p) => Math.max(p.lines_added, p.lines_removed)));
  const busiest = points.reduce(
    (best, p, i) => (p.lines_added + p.lines_removed > points[best]?.lines_added + points[best]?.lines_removed ? i : best),
    0,
  );
  const active = hover ?? busiest;
  const shown = points[active];

  if (points.length === 0 || scale <= 1) {
    return <p className="act-empty">No commits in this window.</p>;
  }

  return (
    <figure className="act-fig">
      <figcaption className="act-cap">
        <span className="act-title">{label}</span>
        <span className="act-legend">
          <span className="act-key">
            <i className="sw added" /> Lines added
          </span>
          <span className="act-key">
            <i className="sw removed" /> Lines removed
          </span>
        </span>
      </figcaption>

      <div className="act-plot" onMouseLeave={() => setHover(null)}>
        <div className="act-scale">
          <span>+{compact(scale)}</span>
          <span>0</span>
          <span>−{compact(scale)}</span>
        </div>
        <div className="act-cols">
          {points.map((p, i) => (
            <div
              key={p.date}
              className={`act-col${i === active ? " on" : ""}`}
              onMouseEnter={() => setHover(i)}
              tabIndex={0}
              onFocus={() => setHover(i)}
              role="img"
              aria-label={`Week of ${dayLabel(p.date)}: ${p.commits} commits, ${p.lines_added} lines added, ${p.lines_removed} removed`}
            >
              <span className="half up">
                <span className="bar added" style={{ height: `${(p.lines_added / scale) * 100}%` }} />
              </span>
              <span className="half down">
                <span className="bar removed" style={{ height: `${(p.lines_removed / scale) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="act-axis">
        <span>{dayLabel(points[0].date)}</span>
        <span className="act-readout">
          <b>{dayLabel(shown.date)}</b> · {compact(shown.commits)} commits ·{" "}
          <span className="ink-added">+{compact(shown.lines_added)}</span>{" "}
          <span className="ink-removed">−{compact(shown.lines_removed)}</span>
        </span>
        <span>{dayLabel(points[points.length - 1].date)}</span>
      </div>

      <details className="act-table">
        <summary>Table</summary>
        <div className="tablewrap">
          <table className="vtable">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Commits</th>
                <th>Added</th>
                <th>Removed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td>{dayLabel(p.date)}</td>
                  <td>{p.commits.toLocaleString("en-US")}</td>
                  <td>{p.lines_added.toLocaleString("en-US")}</td>
                  <td>{p.lines_removed.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** The 12-week trend that rides a list card: one series, churn per week, the
 *  most recent week in the accent and the rest receding. No axis, no legend —
 *  it is a shape, and the numbers beside it carry the values. */
export function MiniChurn({ points }: { points: GearActivity["points"] }) {
  const tail = points.slice(-12);
  const scale = Math.max(1, ...tail.map((p) => p.lines_added + p.lines_removed));
  if (tail.length === 0) return null;
  return (
    <span className="act-mini" aria-hidden="true">
      {tail.map((p, i) => (
        <span
          key={p.date}
          className={`act-tick${i === tail.length - 1 ? " now" : ""}`}
          style={{ height: `${Math.max(6, ((p.lines_added + p.lines_removed) / scale) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** Pull requests, as four numbers rather than a chart.
 *
 * Three counts and a mean is not a chart's job — a stacked bar here would spend
 * the categorical palette to say what four labelled numbers already say, and it
 * would collide with the blue/red the churn chart above uses for a different
 * meaning. The number is the chart. */
export function PullRequestTiles({ prs, previous }: { prs: GearPullRequests; previous?: GearPullRequests | null }) {
  const hours = prs.merged_cycle_hours;
  const tiles: { label: string; value: string; note?: string; trend?: Trend }[] = [
    { label: "Open", value: compact(prs.open), trend: countTrend(prs.open, previous?.open) },
    { label: "Merged", value: compact(prs.merged), trend: countTrend(prs.merged, previous?.merged) },
    { label: "Closed", value: compact(prs.closed), trend: countTrend(prs.closed, previous?.closed) },
    {
      label: "Merge time",
      value: cycleText(hours),
      note: hours === null ? "nothing merged" : "mean, opened → merged",
      trend: mergeTimeTrend(hours, previous?.merged_cycle_hours),
    },
  ];
  return (
    <div className="act-tiles">
      {tiles.map((t) => (
        <div className="act-tile" key={t.label}>
          <span className="act-label">{t.label}</span>
          <span className="act-value">{t.value}</span>
          {t.note && <span className="act-sub">{t.note}</span>}
          {t.trend && (
            <span className={`act-trend act-trend-${t.trend.tone}`} title={t.trend.title}>
              {t.trend.text}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function cycleText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "—";
  return hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours.toFixed(1)}h`;
}

/** How one tile compares with the window before: the text, and whether it is better. */
export interface Trend {
  text: string;
  /** better / worse only where the direction means that; a count is neither. */
  tone: "better" | "worse" | "same" | "neutral";
  title: string;
}

/** A count: up or down by how many, judged neither way — more PRs is not better in itself. */
export function countTrend(now: number, before: number | undefined): Trend | undefined {
  if (before === undefined) return undefined;
  const diff = now - before;
  if (diff === 0) return { text: "= previous", tone: "same", title: `${before} in the previous window too` };
  return {
    text: `${diff > 0 ? "▲" : "▼"} ${compact(Math.abs(diff))} vs previous`,
    tone: "neutral",
    title: `${before} in the previous window`,
  };
}

/** Merge time: shorter is better. Nothing merged in either window says nothing. */
export function mergeTimeTrend(now: number | null, before: number | null | undefined): Trend | undefined {
  if (now === null || before === null || before === undefined) return undefined;
  const diff = now - before;
  // Under an hour, or under 5 %, is the same wait read twice.
  if (Math.abs(diff) < 1 || Math.abs(diff) < before * 0.05) {
    return { text: "= previous", tone: "same", title: `${cycleText(before)} in the previous window` };
  }
  return {
    text: `${diff < 0 ? "Better" : "Worse"} ${diff < 0 ? "−" : "+"}${cycleText(Math.abs(diff))}`,
    tone: diff < 0 ? "better" : "worse",
    title: `${cycleText(before)} in the previous window`,
  };
}

/** The five numbers, as stat tiles. */
export function ActivityTiles({ activity }: { activity: GearActivity }) {
  const tiles: { label: string; value: string; tone?: "added" | "removed" }[] = [
    { label: "Commits", value: compact(activity.commits) },
    { label: "Lines added", value: `+${compact(activity.lines_added)}`, tone: "added" },
    { label: "Lines removed", value: `−${compact(activity.lines_removed)}`, tone: "removed" },
    { label: "Files touched", value: compact(activity.files_changed) },
    { label: "Authors", value: compact(activity.authors) },
  ];
  return (
    <div className="act-tiles">
      {tiles.map((t) => (
        <div className="act-tile" key={t.label}>
          <span className="act-label">{t.label}</span>
          <span className={`act-value${t.tone ? ` ink-${t.tone}` : ""}`}>{t.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── styles ───────────────────────────────────────────────────────────────────
 * Scoped under `.gcat` like the rest of the page, and appended to its stylesheet.
 *
 * The two data colours are a validated diverging pair (blue ↔ red): warm/cool
 * poles that read as opposite, with a neutral rule at zero. Both steps clear the
 * lightness band, the chroma floor, ≥3:1 against the surface they sit on, and
 * ΔE 21.6 (light) / 19.2 (dark) under simulated protanopia — checked with the
 * palette validator rather than by eye, once per theme.
 */
export const ACTIVITY_CSS = `
/* The one pair in this file that stays a literal colour rather than pointing at
 * a product token: added/removed are diverging poles whose exact values were
 * validated (lightness band, chroma floor, contrast, protanopia ΔE) as a pair,
 * per the note above. --avatar-blue / --avatar-red are picked to be
 * distinguishable among twelve, which is a different job, and swapping them in
 * would silently discard that check.
 *
 * The theme switch, though, is the portal's: data-theme on <html>. Keying the
 * dark pair off prefers-color-scheme meant an OS in dark mode repainted these
 * two inside an otherwise light page. */
.gcat {
  --act-added:#2a78d6; --act-removed:#e34948;
  --act-added-soft:color-mix(in srgb,var(--act-added) 30%,var(--studio-surface));
}
:root[data-theme="dark"] .gcat {
  --act-added:#3987e5; --act-removed:#e66767;
}

.gcat .act-panel { min-width:0; border:1px solid var(--studio-line); border-radius:var(--studio-radius);
  background:var(--studio-surface); padding:14px 16px 12px; margin:14px 0; }
.gcat .act-panel > header { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:2px; }
.gcat .act-panel > header h2 { font-size:13px; font-weight:600; margin:0; }
.gcat .act-note { color:var(--studio-muted); font-size:11.5px; margin:0 0 12px; }
.gcat .act-note code { font-family:var(--studio-mono); font-size:11px; }
.gcat .act-prs-note { margin-top:16px; }
.gcat .act-empty { color:var(--studio-muted); font-size:12px; margin:8px 0; }

.gcat .act-tiles { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.gcat .act-tile { flex:1 1 84px; min-width:0; background:var(--studio-surface-raised);
  border-radius:var(--radius-md); padding:8px 10px; display:flex; flex-direction:column; gap:2px; }
.gcat .act-label { font-size:10.5px; color:var(--studio-muted); }
.gcat .act-sub { font-size:10px; color:var(--studio-muted); }
/* "vs previous": a count is neither better nor worse, so it stays muted; only
 * merge time, where shorter is better, is coloured -- and it always says so in
 * words too, so the colour is never the only signal. */
.gcat .act-trend { font-size:10px; font-weight:600; color:var(--studio-muted); }
.gcat .act-trend-better { color:var(--studio-verified); }
.gcat .act-trend-worse { color:var(--studio-danger); }
.gcat .act-value { font-size:17px; font-weight:600; letter-spacing:-.01em; }
.gcat .ink-added { color:var(--act-added); }
.gcat .ink-removed { color:var(--act-removed); }

.gcat .act-fig { margin:0; min-width:0; }
.gcat .act-cap { display:flex; align-items:baseline; justify-content:space-between;
  gap:12px; flex-wrap:wrap; margin-bottom:8px; }
.gcat .act-title { font-size:11.5px; color:var(--studio-muted); }
.gcat .act-legend { display:flex; gap:12px; }
.gcat .act-key { display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--studio-muted); }
.gcat .act-key .sw { width:9px; height:9px; border-radius:2px; display:inline-block; }
.gcat .act-key .sw.added { background:var(--act-added); }
.gcat .act-key .sw.removed { background:var(--act-removed); }

.gcat .act-plot { display:flex; gap:8px; }
.gcat .act-scale { display:flex; flex-direction:column; justify-content:space-between;
  font-size:10px; color:var(--studio-muted); font-variant-numeric:tabular-nums;
  text-align:right; min-width:30px; height:132px; }
.gcat .act-cols { flex:1; display:flex; gap:2px; align-items:stretch; height:132px;
  min-width:0; position:relative; }
/* One hairline across the whole plot. Drawn per column it came out looking
   dashed, which reads as a styled gridline rather than the zero baseline. */
.gcat .act-cols::before { content:""; position:absolute; left:0; right:0; top:50%;
  height:1px; background:var(--studio-line); pointer-events:none; }
.gcat .act-col { flex:1 1 0; min-width:0; display:flex; flex-direction:column;
  cursor:default; outline:none; border-radius:3px; }
.gcat .act-col .half { flex:1 1 0; display:flex; justify-content:center; min-height:0;
  position:relative; }
.gcat .act-col .half.up { align-items:flex-end; }
.gcat .act-col .half.down { align-items:flex-start; }
.gcat .act-col .bar { width:100%; max-width:24px; display:block; }
.gcat .act-col .bar.added { background:var(--act-added); border-radius:4px 4px 0 0; }
.gcat .act-col .bar.removed { background:var(--act-removed); border-radius:0 0 4px 4px; }
.gcat .act-col.on { background:color-mix(in srgb,var(--studio-accent) 8%,transparent); }
.gcat .act-col:focus-visible { box-shadow:inset 0 0 0 1px var(--studio-accent); }

.gcat .act-axis { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:4px 10px;
  margin-top:6px; font-size:10.5px; color:var(--studio-muted); }
.gcat .act-readout { color:var(--studio-text); font-size:11px; text-align:center; flex:1;
  font-variant-numeric:tabular-nums; }

.gcat .act-table { margin-top:10px; }
.gcat .act-table summary { font-size:11px; color:var(--studio-muted); cursor:pointer; }
.gcat .act-table .vtable td { font-variant-numeric:tabular-nums; }

.gcat .act-mini { display:flex; align-items:flex-end; gap:2px; height:18px; width:74px; flex:none; }
.gcat .act-mini .act-tick { flex:1 1 0; background:var(--act-added-soft); border-radius:1.5px 1.5px 0 0; }
.gcat .act-mini .act-tick.now { background:var(--act-added); }

.gcat .act-card { display:flex; align-items:center; gap:8px; font-size:11px;
  color:var(--studio-muted); font-variant-numeric:tabular-nums; }
.gcat .act-card b { color:var(--studio-text); font-weight:600; }
`;
