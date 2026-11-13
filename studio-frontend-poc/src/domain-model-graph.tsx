// Interactive graph of the stored domain model, read live from
// GET /studio-domain-model/v1/model/graph (object_type nodes + inherits/declares
// edges). A self-contained canvas force layout — no graph library.
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "./api";
import { errText } from "./format";

// One bucket, one hue, taken from the product's categorical set (--avatar-*)
// rather than from eleven hand-picked hexes: the same twelve colours the portal
// gives avatars and kind badges, so a bucket dot here and a badge elsewhere
// cannot disagree, and both flip with the theme.
//
// These are `var()` references, which is what the legend and the detail panel
// want — they paint through the DOM. The canvas cannot read a variable, so it
// resolves them once per theme; see `resolve` in the render effect below.
const PALETTE: Record<string, string> = {
  identity: "var(--avatar-mint)", graph: "var(--avatar-pink)",
  governance: "var(--avatar-yellow)", connectors: "var(--avatar-purple)",
  content: "var(--avatar-turquoise)", planning: "var(--avatar-blue)",
  collaboration: "var(--avatar-red)", automation: "var(--avatar-orange)",
  ai: "var(--avatar-magenta)", "kit-management": "var(--avatar-green)",
  "system-primitives": "var(--avatar-grey)",
};
const FALLBACK_BUCKET = "var(--avatar-grey)";
const colorOf = (b: string) => PALETTE[b] ?? FALLBACK_BUCKET;

interface GNode {
  key: string; id: string; name: string; bucket: string; ext: string | null;
  abstract: boolean; fields: number; rels: number;
  props: Record<string, unknown>; // the node's stored payload in Graph Storage
  x: number; y: number; vx: number; vy: number;
  out: GLink[]; in: GLink[];
}
interface GLink { s: GNode; t: GNode; k: "i" | "d"; type: string; payload: Record<string, unknown>; }

interface RawNode { key: string; name: string; payload: Record<string, unknown>; }
export interface RawEdge { type_id: string; from: string; to: string; payload?: Record<string, unknown>; }
export interface RawObj { instance_id: string; entity: string; bucket: string; name: string; value: Record<string, unknown>; }

interface Ctrl { select: (key: string | null) => void; clearEdge: () => void; }

/** Objects to draw instead of the stored instance graph: what a saved view
 *  returns (views.tsx). `key` changes when the objects would. */
export interface GraphSource {
  key: string;
  load: () => Promise<{ nodes: RawObj[]; edges: RawEdge[] }>;
}

export function DomainModelGraph({ token, source }: { token: string; source?: GraphSource }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<Ctrl | null>(null);
  const nodesRef = useRef<Map<string, GNode>>(new Map());
  const filterRef = useRef({ i: true, d: true, off: new Set<string>(), q: "", focus: false });

  const [mode, setMode] = useState<"types" | "instances">(source ? "instances" : "types");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ n: 0, i: 0, d: 0 });
  const [buckets, setBuckets] = useState<{ b: string; n: number }[]>([]);
  const [sel, setSel] = useState<GNode | null>(null);
  const [selEdge, setSelEdge] = useState<GLink | null>(null);
  const [, force] = useState(0); // repaint UI (legend off-state, toggles)

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const cleanup: (() => void)[] = [];

    setLoading(true); setError(null); setSel(null);

    (async () => {
      let nodes: GNode[];
      let rawLinks: { from: string; to: string; k: "i" | "d"; type: string; payload: Record<string, unknown> }[];
      try {
        if (mode === "instances") {
          const raw = source
            ? await source.load()
            : ((await api.domainObjectsGraph(token)) as unknown as { nodes: RawObj[]; edges: RawEdge[] });
          nodes = raw.nodes.map((n) => ({
            key: n.instance_id, id: n.entity, name: n.name || n.instance_id, bucket: n.bucket,
            ext: null, abstract: false, fields: 0, rels: 0, props: n.value ?? {},
            x: 0, y: 0, vx: 0, vy: 0, out: [], in: [],
          }));
          rawLinks = raw.edges.map((e) => ({ from: e.from, to: e.to, k: "d" as const, type: e.type_id, payload: e.payload ?? {} }));
        } else {
          const raw = (await api.domainModelGraph(token)) as unknown as { nodes: RawNode[]; edges: RawEdge[] };
          nodes = raw.nodes.map((n) => ({
            key: n.key, id: String(n.payload.id ?? ""), name: n.name || String(n.payload.name ?? n.payload.id ?? ""),
            bucket: String(n.payload.bucket ?? ""), ext: (n.payload.extends as string | null) ?? null,
            abstract: Boolean(n.payload.abstract), fields: Number(n.payload.field_count ?? 0), rels: Number(n.payload.relation_count ?? 0),
            props: n.payload ?? {},
            x: 0, y: 0, vx: 0, vy: 0, out: [], in: [],
          }));
          rawLinks = raw.edges.map((e) => ({ from: e.from, to: e.to, k: e.type_id.includes("inherits") ? "i" as const : "d" as const, type: e.type_id, payload: e.payload ?? {} }));
        }
      } catch (e) {
        if (!disposed) { setError(errText(e)); setLoading(false); }
        return;
      }
      if (disposed) return;

      const byKey = new Map(nodes.map((n) => [n.key, n]));
      nodesRef.current = byKey;
      const links: GLink[] = rawLinks
        .map((e) => ({ s: byKey.get(e.from)!, t: byKey.get(e.to)!, k: e.k, type: e.type, payload: e.payload }))
        .filter((l) => l.s && l.t);
      for (const l of links) { l.s.out.push(l); l.t.in.push(l); }

      const bkts = [...new Set(nodes.map((n) => n.bucket))].sort();
      const bIndex = new Map(bkts.map((b, i) => [b, i]));
      const bc: Record<string, number> = {};
      for (const n of nodes) bc[n.bucket] = (bc[n.bucket] || 0) + 1;
      const R = 340;
      nodes.forEach((n) => {
        const ba = ((bIndex.get(n.bucket) || 0) / bkts.length) * Math.PI * 2;
        const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 70;
        n.x = Math.cos(ba) * R + Math.cos(a) * r;
        n.y = Math.sin(ba) * R + Math.sin(a) * r;
      });

      setCounts({ n: nodes.length, i: links.filter((l) => l.k === "i").length, d: links.filter((l) => l.k === "d").length });
      setBuckets(bkts.map((b) => ({ b, n: bc[b] })));
      setLoading(false);

      const cv = canvasRef.current!, ctx = cv.getContext("2d")!;
      let W = 0, H = 0, DPR = 1;
      const view = { k: 0.85, x: 0, y: 0 };
      const resize = () => {
        const box = wrapRef.current!.getBoundingClientRect();
        DPR = Math.min(2, window.devicePixelRatio || 1);
        W = Math.max(1, box.width); H = Math.max(1, box.height);
        cv.width = W * DPR; cv.height = H * DPR;
        cv.style.width = W + "px"; cv.style.height = H + "px";
      };
      resize();
      view.x = W / 2; view.y = H / 2;
      const ro = new ResizeObserver(resize);
      ro.observe(wrapRef.current!);
      cleanup.push(() => ro.disconnect());

      /* Canvas paints with colour strings, not with CSS variables, so every
       * token the drawing uses has to be resolved to a concrete value first.
       * getComputedStyle on a custom property is not enough — it hands back the
       * property's *unresolved* text, so a `color-mix(...)` token would reach
       * fillStyle verbatim. A probe element inside the graph resolves anything:
       * assign the expression to its `color` and read the computed value back,
       * which the engine has already reduced to rgb()/rgba(). */
      const probe = document.createElement("span");
      probe.style.display = "none";
      wrapRef.current!.appendChild(probe);
      const resolve = (value: string) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };

      let TOK = { edge: "", edgeI: "", hi: "", text: "", bg: "" };
      /** Bucket colours with their var() references already resolved. */
      let PAINT: Record<string, string> = {};
      let paintFallback = "";
      const paintOf = (b: string) => PAINT[b] ?? paintFallback;
      const readTokens = () => {
        TOK = {
          // The two edge weights are the foreground at two strengths — the
          // graph has no edge colour of its own in either theme.
          edge: resolve("color-mix(in oklab, var(--foreground) 10%, transparent)"),
          edgeI: resolve("color-mix(in oklab, var(--foreground) 28%, transparent)"),
          hi: resolve("var(--primary)"),
          text: resolve("var(--foreground)"),
          bg: resolve("var(--card)"),
        };
        PAINT = Object.fromEntries(
          Object.entries(PALETTE).map(([bucket, value]) => [bucket, resolve(value)])
        );
        paintFallback = resolve(FALLBACK_BUCKET);
      };
      readTokens();
      /* The portal's theme switch is `data-theme` on <html>; the OS preference
       * is a different switch entirely. Watching the latter drew a dark graph
       * inside a light portal whenever the machine was in dark mode. */
      const themeObserver = new MutationObserver(readTokens);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      cleanup.push(() => {
        themeObserver.disconnect();
        probe.remove();
      });

      const F = filterRef.current;
      let hover: GNode | null = null, selected: GNode | null = null, selectedEdge: GLink | null = null;
      const visN = (n: GNode) => !F.off.has(n.bucket);
      const visL = (l: GLink) => (l.k === "i" ? F.i : F.d) && visN(l.s) && visN(l.t);
      // Focus mode: when on and a node is selected, isolate it + its direct
      // neighbours (one type and its relations).
      const focusSet = (): Set<GNode> | null =>
        F.focus && selected
          ? new Set<GNode>([selected, ...selected.out.map((l) => l.t), ...selected.in.map((l) => l.s)])
          : null;
      const radius = (n: GNode) => 4 + Math.sqrt(n.fields + n.rels) * 1.1;
      const sx = (n: GNode) => n.x * view.k + view.x, sy = (n: GNode) => n.y * view.k + view.y;

      let alpha = 1;
      const tick = () => {
        if (alpha < 0.02) return;
        const rep = 5000, cluster = 0.015;
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
            if (d2 > 90000) continue;
            const d = Math.sqrt(d2), f = rep / d2;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        for (const l of links) {
          const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 0.01;
          const f = (d - (l.k === "i" ? 60 : 92)) * (l.k === "i" ? 0.06 : 0.035);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
        }
        for (const n of nodes) {
          const ba = ((bIndex.get(n.bucket) || 0) / bkts.length) * Math.PI * 2;
          n.vx += (Math.cos(ba) * R - n.x) * cluster;
          n.vy += (Math.sin(ba) * R - n.y) * cluster;
          n.vx -= n.x * 0.002; n.vy -= n.y * 0.002;
          if (n === dragging) continue;
          n.vx *= 0.86; n.vy *= 0.86;
          n.x += n.vx * alpha; n.y += n.vy * alpha;
        }
        alpha *= 0.985;
      };

      const draw = () => {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const fs = focusSet();
        const hl = hover || selected;
        const near = hl ? new Set<GNode>([hl, ...hl.out.map((l) => l.t), ...hl.in.map((l) => l.s)]) : null;
        for (const l of links) {
          if (!visL(l) || (fs && !(fs.has(l.s) && fs.has(l.t)))) continue;
          const onE = l === selectedEdge;
          const on = onE || (hl != null && (l.s === hl || l.t === hl));
          ctx.globalAlpha = hl && !on ? 0.06 : 1;
          ctx.beginPath(); ctx.moveTo(sx(l.s), sy(l.s)); ctx.lineTo(sx(l.t), sy(l.t));
          ctx.strokeStyle = on ? TOK.hi : l.k === "i" ? TOK.edgeI : TOK.edge;
          ctx.lineWidth = onE ? 2.6 : on ? 1.6 : l.k === "i" ? 1.1 : 0.7;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        const q = F.q.toLowerCase();
        for (const n of nodes) {
          if (!visN(n) || (fs && !fs.has(n))) continue;
          const dim = (hl != null && near != null && !near.has(n)) || (q !== "" && !(n.name.toLowerCase().includes(q) || n.id.includes(q)));
          const r = radius(n) * (n === hl ? 1.35 : 1) * view.k * 0.9 + 0.5;
          ctx.globalAlpha = dim ? 0.14 : 1;
          ctx.beginPath(); ctx.arc(sx(n), sy(n), r, 0, Math.PI * 2);
          ctx.fillStyle = paintOf(n.bucket); ctx.fill();
          if (n.abstract) { ctx.setLineDash([2, 2]); ctx.lineWidth = 1.4; ctx.strokeStyle = paintOf(n.bucket); ctx.stroke(); ctx.setLineDash([]); }
          else if (n === hl) { ctx.lineWidth = 2; ctx.strokeStyle = TOK.text; ctx.stroke(); }
          if ((hl != null && near != null && near.has(n)) || (selectedEdge != null && (n === selectedEdge.s || n === selectedEdge.t)) || view.k > 1.7 || (q !== "" && !dim)) {
            ctx.globalAlpha = dim ? 0.2 : 1; ctx.fillStyle = TOK.text;
            ctx.font = "600 " + (n === hl ? 13 : 11) + "px system-ui, sans-serif"; ctx.textBaseline = "middle";
            ctx.fillText(n.name, sx(n) + r + 6, sy(n));
          }
        }
        ctx.globalAlpha = 1;
      };

      const loop = () => { tick(); draw(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);

      const pick = (mx: number, my: number): GNode | null => {
        let best: GNode | null = null, bd = Infinity;
        const fs = focusSet();
        for (const n of nodes) {
          if (!visN(n) || (fs && !fs.has(n))) continue;
          const dx = sx(n) - mx, dy = sy(n) - my, d = dx * dx + dy * dy;
          const rr = (radius(n) * view.k + 9) ** 2;
          if (d < rr && d < bd) { best = n; bd = d; }
        }
        return best;
      };

      const doSelect = (n: GNode | null) => { selected = n; selectedEdge = null; setSel(n); setSelEdge(null); };
      const doSelectEdge = (e: GLink | null) => { selectedEdge = e; selected = null; setSelEdge(e); setSel(null); };
      ctrlRef.current = {
        select: (key) => {
          const n = key ? byKey.get(key) ?? null : null;
          doSelect(n);
          if (n) { view.k = Math.max(view.k, 1.5); view.x = W / 2 - n.x * view.k; view.y = H / 2 - n.y * view.k; }
        },
        clearEdge: () => doSelectEdge(null),
      };
      // Nearest visible edge within a few px of (mx,my) — point-to-segment.
      const pickEdge = (mx: number, my: number): GLink | null => {
        let best: GLink | null = null, bd = 8 * 8;
        for (const l of links) {
          if (!visL(l)) continue;
          const ax = sx(l.s), ay = sy(l.s), bx = sx(l.t), by = sy(l.t);
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
          let t = ((mx - ax) * dx + (my - ay) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const px = ax + t * dx, py = ay + t * dy;
          const d = (mx - px) ** 2 + (my - py) ** 2;
          if (d < bd) { bd = d; best = l; }
        }
        return best;
      };

      let dragging: GNode | null = null, panning = false, last = { x: 0, y: 0 }, moved = false;
      const rel = (e: PointerEvent) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      const onDown = (e: PointerEvent) => {
        cv.setPointerCapture(e.pointerId); const p = rel(e); last = p; moved = false;
        const n = pick(p.x, p.y);
        if (n) { dragging = n; } else panning = true;
      };
      const onMove = (e: PointerEvent) => {
        const p = rel(e);
        if (dragging) { moved = true; dragging.x = (p.x - view.x) / view.k; dragging.y = (p.y - view.y) / view.k; dragging.vx = dragging.vy = 0; alpha = Math.max(alpha, 0.3); return; }
        if (panning) { moved = true; view.x += p.x - last.x; view.y += p.y - last.y; last = p; return; }
        hover = pick(p.x, p.y); cv.style.cursor = hover ? "pointer" : "grab";
      };
      const onUp = () => {
        if (dragging && !moved) doSelect(dragging);
        else if (panning && !moved) {
          const e = pickEdge(last.x, last.y);
          if (e) doSelectEdge(e);
          else doSelect(null);
        }
        dragging = null; panning = false;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault(); const b = cv.getBoundingClientRect(); const mx = e.clientX - b.left, my = e.clientY - b.top;
        const nk = Math.min(6, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0012))), r = nk / view.k;
        view.x = mx - (mx - view.x) * r; view.y = my - (my - view.y) * r; view.k = nk;
      };
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("wheel", onWheel, { passive: false });
      cleanup.push(() => {
        cv.removeEventListener("pointerdown", onDown);
        cv.removeEventListener("pointermove", onMove);
        cv.removeEventListener("pointerup", onUp);
        cv.removeEventListener("wheel", onWheel);
      });
    })();

    return () => { disposed = true; cancelAnimationFrame(raf); cleanup.forEach((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `source.key` stands for `source`
  }, [token, mode, source?.key]);

  const repaint = () => force((x) => x + 1);
  const setFilter = (patch: Partial<typeof filterRef.current>) => { Object.assign(filterRef.current, patch); repaint(); };
  const toggleBucket = (b: string) => { const off = filterRef.current.off; if (off.has(b)) off.delete(b); else off.add(b); repaint(); };

  const F = filterRef.current;
  const decl = sel ? sel.out.filter((l) => l.k === "d").map((l) => l.t) : [];
  const subs = sel ? sel.in.filter((l) => l.k === "i").map((l) => l.s) : [];

  return (
    <div className="dmg" ref={wrapRef}>
      <style>{DMG_CSS}</style>
      <canvas ref={canvasRef} className="dmg-canvas" />
      <div className="dmg-bar">
        {!source && (
          <span className="dmg-mode">
            <button className={mode === "types" ? "on" : ""} onClick={() => setMode("types")}>Types</button>
            <button className={mode === "instances" ? "on" : ""} onClick={() => setMode("instances")}>Instances</button>
          </span>
        )}
        <span className="dmg-counts">
          {mode === "instances"
            ? <><b>{counts.n}</b> objects · <b>{counts.d}</b> relations</>
            : <><b>{counts.n}</b> types · <b>{counts.i}</b> inherits · <b>{counts.d}</b> declares</>}
        </span>
        <input className="dmg-search" type="search" placeholder="Find a type…" spellCheck={false}
          onChange={(e) => setFilter({ q: e.target.value.trim() })} />
        <label className="dmg-tog"><input type="checkbox" checked={F.i} onChange={(e) => setFilter({ i: e.target.checked })} /> inherits</label>
        <label className="dmg-tog"><input type="checkbox" checked={F.d} onChange={(e) => setFilter({ d: e.target.checked })} /> declares</label>
      </div>

      {loading && <div className="dmg-msg">Loading graph…</div>}
      {error && <div className="dmg-msg dmg-err">{error}</div>}
      {!loading && !error && counts.n === 0 && (
        <div className="dmg-msg">
          {source
            ? "Nothing matches this view."
            : mode === "instances"
            ? "No objects yet — create some in the panel above, then relate them."
            : "Model is empty — run Sync to graph first."}
        </div>
      )}

      {buckets.length > 0 && (
        <div className="dmg-legend">
          {buckets.map(({ b, n }) => (
            /* A toggle, and now one the keyboard can reach and a screen
               reader can read: `aria-pressed` carries the on/off that the
               `off` class only showed. It stays a div rather than becoming a
               button because `.dmg-lrow` lays out three spans and a button
               would bring its own box to fight with. */
            <div
              key={b}
              role="button"
              tabIndex={0}
              aria-pressed={!F.off.has(b)}
              className={"dmg-lrow" + (F.off.has(b) ? " off" : "")}
              onClick={() => toggleBucket(b)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleBucket(b);
                }
              }}
            >
              <span className="dmg-dot" style={{ background: colorOf(b) }} /><span>{b}</span><span className="dmg-n">{n}</span>
            </div>
          ))}
        </div>
      )}

      {sel && (
        <div className="dmg-detail">
          <button className="dmg-close" aria-label="Close" onClick={() => ctrlRef.current?.select(null)}>×</button>
          <span className="dmg-kind"><span className="dmg-dot" style={{ background: colorOf(sel.bucket) }} />{sel.bucket}{sel.abstract ? " · abstract" : ""}</span>
          <h3>{sel.name}</h3>
          <div className="dmg-id">{sel.id}</div>
          <button className={"dmg-focus" + (F.focus ? " on" : "")}
            onClick={() => setFilter({ focus: !F.focus })}>
            {F.focus ? "Show whole graph" : "Focus this type + relations"}
          </button>
          {sel.ext && <div className="dmg-rel">extends <a onClick={() => selectByEntity(nodesRef.current, sel.ext!, ctrlRef.current)}>{sel.ext}</a></div>}
          <div className="dmg-stats">
            <div><b>{sel.fields}</b><span>fields</span></div>
            <div><b>{sel.rels}</b><span>relations</span></div>
            <div><b>{subs.length}</b><span>subtypes</span></div>
          </div>
          {Object.keys(sel.props).length > 0 && (
            <div className="dmg-sec">
              <h4>Stored in graph</h4>
              {Object.entries(sel.props).map(([k, v]) => (
                <div className="dmg-prop" key={k}>
                  <span className="dmg-pk">{k}</span>
                  <span className="dmg-pv">{fmtVal(v)}</span>
                </div>
              ))}
            </div>
          )}
          <RelList title={`Declares → (${decl.length})`} items={decl.slice(0, 30)} ctrl={ctrlRef} />
          {subs.length > 0 && <RelList title={`Subtypes (${subs.length})`} items={subs.slice(0, 30)} ctrl={ctrlRef} />}
        </div>
      )}

      {selEdge && (
        <div className="dmg-detail">
          <button className="dmg-close" aria-label="Close" onClick={() => ctrlRef.current?.clearEdge()}>×</button>
          <span className="dmg-kind">{edgeVerb(selEdge)} edge</span>
          <h3>{selEdge.s.name} <span className="dmg-arrow">→</span> {selEdge.t.name}</h3>
          <div className="dmg-id">{selEdge.s.id} → {selEdge.t.id}</div>
          {Object.keys(selEdge.payload).length > 0 ? (
            <div className="dmg-sec">
              <h4>Edge properties (stored in graph)</h4>
              {Object.entries(selEdge.payload).map(([k, v]) => (
                <div className="dmg-prop" key={k}><span className="dmg-pk">{k}</span><span className="dmg-pv">{fmtVal(v)}</span></div>
              ))}
            </div>
          ) : (
            <div className="dmg-rel dmg-muted" style={{ marginTop: 10 }}>No stored properties on this edge.</div>
          )}
        </div>
      )}
    </div>
  );
}

function edgeVerb(l: GLink): string {
  if (l.type.includes("inherits")) return "inherits";
  if (l.type.includes("declares")) return "declares";
  const toks = l.type.replace(/~$/, "").split(".");
  return toks.length >= 2 ? toks[toks.length - 2] : l.type;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function selectByEntity(byKey: Map<string, GNode>, entityId: string, ctrl: Ctrl | null) {
  for (const n of byKey.values()) if (n.id === entityId) { ctrl?.select(n.key); return; }
}

function RelList({ title, items, ctrl }: { title: string; items: GNode[]; ctrl: RefObject<Ctrl | null> }) {
  return (
    <div className="dmg-sec">
      <h4>{title}</h4>
      {items.length === 0 ? <div className="dmg-rel dmg-muted">none</div> : items.map((m) => (
        <div key={m.key} className="dmg-rel">
          <a onClick={() => ctrl.current?.select(m.key)}>{m.name}</a><span className="dmg-muted">{m.bucket}</span>
        </div>
      ))}
    </div>
  );
}

const DMG_CSS = `
/* Every colour here is a product token. The block that used to follow
 * prefers-color-scheme is gone on purpose: the portal's theme is data-theme on
 * <html>, and the tokens below already flip with it — keying off the OS meant a
 * dark graph sitting inside a light portal on any machine set to dark. The
 * floating panels are translucent over the canvas, so they mix --card with a
 * little transparency rather than naming a second surface. */
.dmg { position: relative; width: 100%; height: 70vh; min-height: 420px; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: var(--muted); }
.dmg-canvas { display: block; width: 100%; height: 100%; }
.dmg-bar { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font: var(--text-meta-size)/1.4 var(--font-sans); }
.dmg-mode { display: inline-flex; border: 1px solid var(--input); border-radius: var(--radius-lg); overflow: hidden; }
.dmg-mode button { font: inherit; border: none; background: color-mix(in oklab, var(--card) 70%, transparent); color: var(--muted-foreground); padding: 5px 11px; cursor: pointer; }
.dmg-mode button + button { border-left: 1px solid var(--input); }
.dmg-mode button.on { background: var(--primary); color: var(--primary-foreground); }
.dmg-counts { color: var(--muted-foreground); font-variant-numeric: tabular-nums; } .dmg-counts b { color: inherit; }
.dmg-search { font: inherit; padding: 5px 9px; border: 1px solid var(--input); border-radius: var(--radius-lg); background: color-mix(in oklab, var(--card) 80%, transparent); color: var(--foreground); outline: none; margin-left: auto; }
.dmg-tog { display: inline-flex; gap: 5px; align-items: center; color: var(--muted-foreground); user-select: none; cursor: pointer; }
.dmg-legend { position: absolute; left: 10px; bottom: 10px; background: color-mix(in oklab, var(--card) 92%, transparent); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 7px; font: var(--text-meta-size)/1.3 var(--font-sans); color: var(--foreground); max-height: 46%; overflow: auto; }
.dmg-lrow { display: flex; gap: 7px; align-items: center; padding: 2px 4px; border-radius: var(--radius-md); cursor: pointer; } .dmg-lrow:hover { background: color-mix(in oklab, var(--foreground) 6%, transparent); } .dmg-lrow.off { opacity: .38; }
.dmg-dot { width: 10px; height: 10px; border-radius: var(--radius-sm); flex: none; } .dmg-n { margin-left: auto; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.dmg-detail { position: absolute; right: 10px; top: 44px; width: 270px; max-height: calc(100% - 60px); overflow: auto; background: color-mix(in oklab, var(--card) 95%, transparent); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px; box-shadow: var(--shadow-lg); color: var(--foreground); font: var(--text-body-size)/1.5 var(--font-sans); }
.dmg-close { float: right; border: none; background: none; font-size: 18px; line-height: 1; color: var(--muted-foreground); cursor: pointer; }
.dmg-kind { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted-foreground); display: inline-flex; gap: 6px; align-items: center; }
.dmg-detail h3 { margin: 5px 0 2px; font-size: 17px; } .dmg-id { font: 11.5px var(--font-mono); color: var(--muted-foreground); word-break: break-all; }
.dmg-arrow { color: var(--muted-foreground); }
.dmg-focus { margin-top: 10px; width: 100%; font: var(--text-meta-size) var(--font-sans); padding: 6px 10px; border: 1px solid var(--input); border-radius: var(--radius-lg); background: var(--muted); color: var(--foreground); cursor: pointer; }
.dmg-focus:hover { border-color: var(--primary); color: var(--primary); } .dmg-focus.on { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.dmg-stats { display: flex; gap: 7px; margin: 12px 0; } .dmg-stats > div { flex: 1; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 7px 9px; } .dmg-stats b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; } .dmg-stats span { font-size: 10px; text-transform: uppercase; color: var(--muted-foreground); letter-spacing: .04em; }
.dmg-sec { margin-top: 12px; } .dmg-sec h4 { margin: 0 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted-foreground); }
.dmg-rel { padding: 2px 0; display: flex; gap: 6px; } .dmg-rel a { color: var(--link-foreground); cursor: pointer; } .dmg-rel a:hover { text-decoration: underline; } .dmg-muted { color: var(--muted-foreground); font-size: 11.5px; }
.dmg-prop { display: grid; grid-template-columns: 88px 1fr; gap: 8px; padding: 2px 0; align-items: baseline; }
.dmg-pk { color: var(--muted-foreground); font: 11px var(--font-mono); overflow: hidden; text-overflow: ellipsis; }
.dmg-pv { font: var(--text-meta-size) var(--font-mono); word-break: break-word; }
.dmg-msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted-foreground); font: var(--text-body-size) var(--font-sans); } .dmg-err { color: var(--destructive); }
`;
