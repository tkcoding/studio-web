/**
 * The map drawn (the prototype's `Canvas` and `ScreenPreview`,
 * product-map-view.tsx): one lane per layer, groups as columns in their
 * subsystem's hue, the shell drawn as the app it is with its menu of screens,
 * and the links as lines over the lanes, measured off the drawn nodes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import type { ScreenPreview as ScreenPicture } from '../../../api/types';
import { productApi } from '../../../api/client';
import {
  MAP_LAYERS,
  MISSING_GROUP,
  groupsOf,
  linksOf,
  type MapLayer,
  type MapLink,
  type MapNode,
  type MapOverlay,
  type ProductMap as Map_,
} from '../../../model/product-map';
import { previewBuild, shortCommit, type PreviewBuild } from '../../../model/screen-previews';
import { useMapTranslations } from '../../../i18n';
import { DRAG_GEAR, DRAG_MFE, KIND_GLYPH, hueOf, kindWord, screensOf, stateWord, type MapLook, type Text } from './words';
import styles from './ProductMap.module.css';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/* ── A micro-frontend's screens, drawn ── */

/** Each component's pictures, read once per page: a build adds them, and a
 *  reload is when a reader expects to see a new one. */
const pictures = new Map<string, Promise<ScreenPicture[]>>();

function usePictures(component: string | null): ScreenPicture[] | null {
  const [items, setItems] = useState<ScreenPicture[] | null>(null);
  useEffect(() => {
    if (!component) return;
    let live = true;
    let read = pictures.get(component);
    if (!read) {
      read = productApi.screenPreviews(component).then(
        (r) => r.items ?? [],
        (): ScreenPicture[] => []
      );
      pictures.set(component, read);
    }
    void read.then((r) => {
      if (live) setItems(r);
    });
    return () => {
      live = false;
    };
  }, [component]);
  return component ? items : null;
}

/** What a micro-frontend puts in the shell, as a small window: the picture a
 *  build took of each screen when the catalogue keeps one for this version,
 *  otherwise drawn from what its manifest declares and labelled a schematic.
 *  `bare` leaves out the menu, for a page drawn inside the shell's window. */
export function ScreenPreview({
  name,
  screens,
  pictured,
  screen,
  bare = false,
}: {
  name: string;
  screens: string[];
  pictured: { component: string; version: string | null } | null;
  screen?: string | null;
  bare?: boolean;
}) {
  const items = usePictures(pictured?.component ?? null);
  const build = items ? previewBuild(items, pictured?.version ?? null) : null;
  if (build) return <BuiltPreview key={screen ?? ''} name={name} build={build} screen={screen ?? null} bare={bare} />;
  return <SchematicPreview name={name} screens={screens} screen={screen ?? null} bare={bare} />;
}

/** The pictures of one build: one screen large, every screen as a tab that shows it on hover. */
function BuiltPreview({ name, build, screen, bare }: { name: string; build: PreviewBuild; screen: string | null; bare: boolean }) {
  const { t } = useMapTranslations();
  const [on, setOn] = useState(() =>
    Math.max(
      0,
      build.screens.findIndex((s) => s.label === screen || s.route === screen)
    )
  );
  const shot = build.screens[Math.min(on, build.screens.length - 1)];
  return (
    <span className={styles.previewHold} onClick={(e) => e.stopPropagation()}>
      <span
        className={styles.preview}
        role="img"
        aria-label={`${name}: ${build.screens.map((s) => s.label ?? s.route).join(', ')}, built at ${build.commit}`}
        data-pmap-preview="built"
      >
        <span className={styles.previewBar}>
          <span className={styles.previewUrl}>{shot.route}</span>
          <span
            className={styles.previewTag}
            title={t('preview_built_title', {
              commit: build.commit,
              version: build.version ?? '—',
              at: build.capturedAt,
            })}
          >
            {t('preview_built', { commit: shortCommit(build.commit) })}
          </span>
        </span>
        <img className={styles.previewShot} src={shot.image} alt={shot.label ?? shot.route} />
        {build.screens.length > 1 && !bare && (
          <span className={styles.previewThumbs}>
            {build.screens.map((s, i) => (
              <span
                key={s.route}
                className={cx(styles.previewThumb, s === shot && styles.on)}
                onMouseEnter={() => setOn(i)}
                title={s.route}
              >
                <img src={s.image} alt="" />
                <span>{s.label ?? s.route}</span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** Drawn from what the manifest declares: the screens in the shell's
 *  navigation, the first one open. Not a picture of the running screen. */
function SchematicPreview({ name, screens, screen, bare }: { name: string; screens: string[]; screen: string | null; bare: boolean }) {
  const { t } = useMapTranslations();
  const shown = screens.slice(0, 8);
  const open = screen && screens.includes(screen) ? screen : (shown[0] ?? null);
  return (
    <span
      className={styles.preview}
      role="img"
      aria-label={`${name}: ${screens.length ? screens.join(', ') : t('no_screens')}`}
      data-pmap-preview="schematic"
    >
      <span className={styles.previewBar}>
        <span className={styles.previewUrl}>/{(open ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}</span>
        <span className={styles.previewTag}>{t('preview_schematic')}</span>
      </span>
      <span className={styles.previewBody}>
        {!bare && (
          <span className={styles.previewNav}>
            {shown.length === 0 && <span className={styles.muted}>{t('no_screens')}</span>}
            {shown.map((s) => (
              <span key={s} className={cx(styles.previewItem, s === open && styles.on)}>
                {s}
              </span>
            ))}
            {screens.length > shown.length && (
              <span className={styles.muted}>{t('more', { count: String(screens.length - shown.length) })}</span>
            )}
          </span>
        )}
        <span className={styles.previewPage}>
          <span className={styles.previewTitle}>{open ?? name}</span>
          <span className={styles.previewLine} style={{ width: '80%' }} />
          <span className={styles.previewLine} style={{ width: '95%' }} />
          <span className={styles.previewLine} style={{ width: '60%' }} />
        </span>
      </span>
    </span>
  );
}

/* ── The lanes and the links ── */

/** One drawn line: every link between the same two drawn ends (a folded
 *  group draws its nodes' links at its header), `count` of them. */
type Path = {
  key: string;
  d: string;
  link: MapLink;
  links: MapLink[];
  count: number;
  mid: { x: number; y: number };
  hue: number | null;
};

/** The groups of a lane in the order that crosses fewest lines: by the mean
 *  place of what links into them from the lane above (a barycentre). The
 *  engine's group of what is missing stays first. */
function laneOrder(
  groups: { group: string; nodes: MapNode[] }[],
  above: Map<string, number>,
  links: readonly MapLink[]
): { group: string; nodes: MapNode[] }[] {
  if (above.size === 0) return groups;
  const score = (g: { nodes: MapNode[] }) => {
    const ids = new Set(g.nodes.map((n) => n.id));
    const at: number[] = [];
    for (const l of links) {
      if (ids.has(l.to) && above.has(l.from)) at.push(above.get(l.from)!);
      else if (ids.has(l.from) && above.has(l.to)) at.push(above.get(l.to)!);
    }
    return at.length ? at.reduce((a, b) => a + b, 0) / at.length : Number.POSITIVE_INFINITY;
  };
  return groups
    .map((g, i) => ({ g, i, s: g.group === MISSING_GROUP ? Number.NEGATIVE_INFINITY : score(g) }))
    .sort((a, b) => (a.s === b.s ? a.i - b.i : a.s - b.s))
    .map((x) => x.g);
}

const LINK_CLASS: Record<MapLink['kind'], string> = {
  calls: styles.linkCalls,
  'runs-on': styles.linkRunsOn,
  'signs-in': styles.linkSignsIn,
  depends: styles.linkDepends,
  'stores-in': styles.linkStoresIn,
};

const STATE_CLASS: Record<MapNode['state'], string> = {
  ok: styles.ok,
  missing: styles.missing,
  bad: styles.bad,
  warn: styles.warn,
  unused: styles.unused,
};

export function MapCanvas({
  find,
  look,
  map,
  nodeById,
  layers,
  selected,
  link,
  collapsed,
  overlay,
  hasFrontend,
  absence,
  onFrontend,
  pictured,
  onSelect,
  onLink,
  onToggleGroup,
  onDropScreen,
  onDropGear,
}: {
  find: string;
  look: MapLook;
  map: Map_;
  nodeById: Map<string, MapNode>;
  layers: Set<MapLayer>;
  selected: string | null;
  link: MapLink | null;
  collapsed: Set<string>;
  overlay?: MapOverlay;
  hasFrontend: boolean;
  absence: { text: string; tone: 'none' | 'warn' };
  onFrontend: () => void;
  pictured: Map<string, { component: string; version: string | null }>;
  onSelect: (id: string | null) => void;
  onLink: (l: MapLink) => void;
  onToggleGroup: (key: string) => void;
  onDropScreen: (name: string) => void;
  onDropGear: (name: string) => void;
}) {
  const { t } = useMapTranslations();
  const box = useRef<HTMLDivElement | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<Path[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [over, setOver] = useState<MapLayer | null>(null);
  /** The node the pointer is on: its links show as if it were selected. */
  const [hover, setHover] = useState<string | null>(null);
  // The screen hovered in the app window's menu, which its page shows.
  const [screenOn, setScreenOn] = useState<{ node: string; screen: string } | null>(null);
  const lanes = MAP_LAYERS.filter((l) => layers.has(l.id));

  // Each lane's groups ordered under what links into them from the lane
  // above, so lines run down rather than across.
  const laneGroups = useMemo(() => {
    const out = new Map<MapLayer, { group: string; nodes: MapNode[] }[]>();
    let above = new Map<string, number>();
    for (const lane of MAP_LAYERS) {
      const groups = laneOrder(groupsOf(map.nodes, lane.id), above, map.links);
      out.set(lane.id, groups);
      if (!layers.has(lane.id)) continue;
      const next = new Map<string, number>();
      groups.flatMap((g) => g.nodes).forEach((n, i) => next.set(n.id, i));
      above = next;
    }
    return out;
  }, [map, layers]);

  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const at = el.getBoundingClientRect();
    const rank = (layer: MapLayer) => MAP_LAYERS.findIndex((l) => l.id === layer);
    const key = (n: MapNode) => `${n.layer}:${n.group}`;
    // `end` names what is drawn for a node -- its group's header while the
    // group is folded -- so links between the same drawn ends are one line.
    const endOf = (id: string) => {
      const n = nodeById.get(id);
      if (!n || !layers.has(n.layer)) return null;
      // A database is drawn only while its PostgreSQL is open.
      if (n.parent && (collapsed.has(key(n)) || collapsed.has(`dbs:${n.parent}`))) return null;
      const end = n.layer !== 'frontend' && collapsed.has(key(n)) ? `group:${key(n)}` : id;
      const node = refs.current.get(end);
      const r = node?.getBoundingClientRect();
      if (!node || !r) return null;
      // A node scrolled out of its row is drawn at the row's edge.
      const row = node.closest('[data-pmap-row]')?.getBoundingClientRect();
      let left = r.left;
      let width = r.width;
      if (row) {
        const l = Math.max(left, row.left);
        const rr = Math.min(left + width, row.right);
        if (rr - l < 8) {
          left = left < row.left ? row.left : row.right - 8;
          width = 8;
        } else {
          left = l;
          width = rr - l;
        }
      }
      return { end, layer: n.layer, x: left - at.left, y: r.top - at.top, w: width, h: r.height };
    };
    type End = NonNullable<ReturnType<typeof endOf>>;
    const bundles = new Map<string, { a: End; b: End; links: MapLink[] }>();
    for (const l of map.links) {
      const a = endOf(l.from);
      const b = endOf(l.to);
      if (!a || !b || a.end === b.end) continue;
      const k = `${a.end}>${b.end}`;
      const had = bundles.get(k);
      if (had) had.links.push(l);
      else bundles.set(k, { a, b, links: [l] });
    }
    // Lines between lanes leave the bottom and arrive at the top; within a
    // lane both ends are at the bottom.
    const sides = (a: End, b: End) => {
      const same = rank(a.layer) === rank(b.layer);
      const down = rank(a.layer) < rank(b.layer);
      return { aBottom: same || down, bBottom: same || !down };
    };
    // A node's lines are spread along its edge in the order of their other ends.
    const edges = new Map<string, { key: string; other: number }[]>();
    const onEdge = (edge: string, k: string, other: End) =>
      edges.set(edge, [...(edges.get(edge) ?? []), { key: k, other: other.x + other.w / 2 }]);
    for (const [k, { a, b }] of bundles) {
      const { aBottom, bBottom } = sides(a, b);
      onEdge(`${a.end}:${aBottom ? 'b' : 't'}`, k, b);
      onEdge(`${b.end}:${bBottom ? 'b' : 't'}`, k, a);
    }
    const xOn = (end: End, edge: string, k: string) => {
      const list = [...(edges.get(edge) ?? [])].sort((p, q) => p.other - q.other);
      const i = list.findIndex((e) => e.key === k);
      const pad = Math.min(12, end.w / 4);
      const span = end.w - 2 * pad;
      return end.x + pad + (list.length <= 1 ? span / 2 : (span * i) / (list.length - 1));
    };
    const out: Path[] = [];
    for (const [k, { a, b, links }] of bundles) {
      const { aBottom, bBottom } = sides(a, b);
      const ax = xOn(a, `${a.end}:${aBottom ? 'b' : 't'}`, k);
      const bx = xOn(b, `${b.end}:${bBottom ? 'b' : 't'}`, k);
      const ay = aBottom ? a.y + a.h : a.y;
      const by = bBottom ? b.y + b.h : b.y;
      let d: string;
      let mid: { x: number; y: number };
      if (aBottom && bBottom) {
        const dip = Math.max(ay, by) + 24;
        d = `M${ax},${ay} C${ax},${dip} ${bx},${dip} ${bx},${by}`;
        mid = { x: (ax + bx) / 2, y: dip - 6 };
      } else {
        const m = (ay + by) / 2;
        d = `M${ax},${ay} C${ax},${m} ${bx},${m} ${bx},${by}`;
        mid = { x: (ax + bx) / 2, y: m };
      }
      // The line speaks for its worst link: a bad one is never hidden in a bundle.
      const worst = links.find((l) => l.state === 'bad') ?? links[0];
      // Coloured as the subsystem it arrives at, so a bundle reads by colour.
      const to = nodeById.get(worst.to);
      out.push({ key: k, d, link: worst, links, count: links.length, mid, hue: to && to.layer !== 'frontend' ? hueOf(to.group) : null });
    }
    setPaths(out);
    setSize({ w: el.scrollWidth, h: el.scrollHeight });
    // `look` and `find` change what is drawn, so where the lines go.
  }, [map, nodeById, layers, collapsed, look, find]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measured once the lanes are laid out, and again whenever they resize.
  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  // What is lit: the selection, else what the pointer is on.
  const lit = selected ?? (link ? null : hover);
  const touches = (l: MapLink) => (lit ? l.from === lit || l.to === lit : link ? l === link : false);
  const linked = new Set<string>();
  if (lit) for (const l of linksOf(map, lit)) linked.add(l.from === lit ? l.to : l.from);
  if (link) {
    linked.add(link.from);
    linked.add(link.to);
  }
  const q = find.trim().toLowerCase();
  const found = new Set(
    q ? map.nodes.filter((n) => n.label.toLowerCase().includes(q) || n.group.toLowerCase().includes(q)).map((n) => n.id) : []
  );
  if (!lit && !link) for (const id of found) linked.add(id);
  const focus = !!lit || !!link || !!q;
  const dim = (id: string) => focus && !linked.has(id) && lit !== id;

  const accepts = (layer: MapLayer, e: DragEvent) =>
    (layer === 'frontend' && e.dataTransfer.types.includes(DRAG_MFE)) ||
    (layer === 'backend' && e.dataTransfer.types.includes(DRAG_GEAR));

  const chip = (n: MapNode) => {
    const run = overlay?.get(n.id);
    const shows = n.detail.kind === 'mfe' ? screensOf(n) : [];
    const calls = map.links.filter((l) => l.from === n.id && l.kind === 'calls').length;
    return (
      <button
        key={n.id}
        ref={setRef(n.id)}
        type="button"
        className={cx(
          styles.node,
          STATE_CLASS[n.state],
          selected === n.id && styles.on,
          found.has(n.id) && styles.found,
          linked.has(n.id) && styles.linked,
          dim(n.id) && styles.dim
        )}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
        // A screen card shows its own preview; a tooltip would cover it.
        title={
          n.detail.kind === 'mfe'
            ? undefined
            : `${kindWord(t, n.detail.kind)}: ${n.label}${n.state !== 'ok' ? ` (${stateWord(t, n.state)})` : ''}`
        }
        onClick={(e) => {
          e.stopPropagation();
          onSelect(selected === n.id ? null : n.id);
        }}
        aria-expanded={selected === n.id}
        aria-controls="pmap-detail"
        data-pmap-node={n.id}
        data-pmap-state={n.state}
      >
        <span className={styles.nodeLabel}>
          <span className={cx(styles.stateDot, STATE_CLASS[n.state])} aria-hidden />
          <span className={styles.glyph} aria-hidden>
            {KIND_GLYPH[n.detail.kind]}
          </span>
          {n.label}
        </span>
        {n.state !== 'ok' && <span className={styles.nodeState}>{stateWord(t, n.state)}</span>}
        {look === 'subsystems' && n.detail.kind !== 'mfe' && n.detail.kind !== 'database' && (
          <span className={styles.nodeWhat}>{n.detail.what}</span>
        )}
        {look === 'subsystems' && n.detail.kind === 'mfe' && (
          <>
            <span className={styles.nodeWhat}>{shows.length ? shows.join(', ') : n.detail.what}</span>
            <span className={styles.nodeMeta}>
              {shows.length ? `${t('screens_count', { count: String(shows.length) })} · ` : ''}
              {t('calls_gears', { count: String(calls) })}
            </span>
          </>
        )}
        {n.detail.kind === 'mfe' && hover === n.id && (
          <ScreenPreview name={n.label} screens={shows} pictured={pictured.get(n.id) ?? null} />
        )}
        {(n.badges ?? []).map((b) => (
          <span key={b.text} className={cx(styles.badge, styles[`badge_${b.tone}`])}>
            {b.text}
          </span>
        ))}
        {run && (
          <span className={cx(styles.badge, run.health === 'failing' ? styles.badge_bad : styles.badge_info)}>
            {run.version ?? '?'} {run.health ?? ''}
          </span>
        )}
      </button>
    );
  };

  /** A node and what is drawn under it: PostgreSQL and its databases, which fold under it on their own. */
  const withChildren = (n: MapNode, all: readonly MapNode[]) => {
    const kids = all.filter((k) => k.parent === n.id);
    if (kids.length === 0) return chip(n);
    const key = `dbs:${n.id}`;
    const folded = collapsed.has(key) && !kids.some((k) => found.has(k.id));
    return (
      <div key={n.id} className={styles.parent} data-pmap-parent={n.id}>
        {chip(n)}
        <button
          type="button"
          className={cx(styles.kidsHead, kids.some((k) => linked.has(k.id) || k.id === selected) && folded && styles.linked)}
          aria-expanded={!folded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleGroup(key);
          }}
          title={folded ? t('kids_unfold') : t('kids_fold')}
          data-pmap-kids-toggle={n.id}
        >
          {folded ? '▸' : '▾'} {t('databases', { count: String(kids.length) })}
        </button>
        {!folded && <div className={styles.kids}>{kids.map((k) => chip(k))}</div>}
      </div>
    );
  };

  const app = (shell: MapNode, groups: { group: string; nodes: MapNode[] }[], tx: Text) => {
    // The shell drawn as the app it is. Its menu is the screens, each group
    // of them a micro-frontend; the page shows the screen hovered.
    const mounted = groups.flatMap((g) => g.nodes).filter((n) => n.id !== shell.id);
    if (mounted.length === 0) return <p className={styles.muted}>{tx('app_empty')}</p>;
    const pages = mounted.filter((n) => screensOf(n).length > 0);
    const shared = mounted.filter((n) => screensOf(n).length === 0);
    const shown = pages.find((n) => n.id === lit) ?? pages[0];
    const screen = screenOn && screenOn.node === shown?.id ? screenOn.screen : null;
    const MENU = 4;
    return (
      <>
        <div className={styles.appBody}>
          <nav className={styles.appNav} aria-label={tx('app_menu', { name: shell.label })}>
            {pages.map((n) => (
              <div
                key={n.id}
                ref={setRef(n.id)}
                role="button"
                tabIndex={0}
                className={cx(
                  styles.appMenu,
                  STATE_CLASS[n.state],
                  shown?.id === n.id && styles.on,
                  selected === n.id && styles.picked,
                  dim(n.id) && styles.dim
                )}
                data-pmap-node={n.id}
                data-pmap-state={n.state}
                aria-expanded={selected === n.id}
                aria-controls="pmap-detail"
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(selected === n.id ? null : n.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(selected === n.id ? null : n.id);
                  }
                }}
              >
                <span className={styles.appMfe}>
                  {n.label}
                  {n.state !== 'ok' && ` · ${stateWord(tx, n.state)}`}
                </span>
                {screensOf(n)
                  .slice(0, MENU)
                  .map((s) => (
                    <span
                      key={s}
                      className={cx(styles.appItem, screen === s && shown?.id === n.id && styles.on)}
                      onMouseEnter={() => setScreenOn({ node: n.id, screen: s })}
                    >
                      {s}
                    </span>
                  ))}
                {screensOf(n).length > MENU && (
                  <span className={cx(styles.appItem, styles.muted)}>
                    {tx('more', { count: String(screensOf(n).length - MENU) })}
                  </span>
                )}
              </div>
            ))}
          </nav>
          {shown && (
            <div className={styles.appStage} data-pmap-stage={shown.id}>
              <span className={styles.appDrawn}>{shown.label}</span>
              <ScreenPreview
                name={shown.label}
                screens={screensOf(shown)}
                pictured={pictured.get(shown.id) ?? null}
                screen={screen}
                bare
              />
            </div>
          )}
        </div>
        {shared.length > 0 && (
          <div className={styles.appShared}>
            <span className={styles.muted}>{tx('app_shared')}</span>
            {shared.map((n) => chip(n))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className={cx(styles.canvas, look === 'compact' && styles.compact)} ref={box} onClick={() => onSelect(null)} data-pmap-canvas>
      <svg className={styles.links} width={size.w} height={size.h} aria-hidden>
        {paths.map((p) => {
          // Gear-to-gear and gear-to-database links show only for what is
          // selected or pointed at: the lanes would be a web otherwise.
          const on = p.links.some(touches);
          if (p.links.every((l) => l.kind === 'depends' || l.kind === 'stores-in') && !on) return null;
          const cls = cx(styles.link, LINK_CLASS[p.link.kind], p.link.state === 'bad' && styles.linkBad, on ? styles.linkOn : focus && styles.dim);
          return (
            <g key={p.key}>
              <path
                className={cls}
                d={p.d}
                style={{
                  ...(p.count > 1 ? { strokeWidth: `${Math.min(5, 1.2 + Math.log2(p.count))}px` } : {}),
                  ...(p.hue !== null && p.link.state !== 'bad' ? { stroke: `hsl(${p.hue} 62% 52%)` } : {}),
                }}
                data-pmap-link={p.key}
              />
              {p.count > 1 && (on || !focus) && (
                <text className={styles.linkCount} x={p.mid.x} y={p.mid.y} textAnchor="middle" dominantBaseline="middle">
                  {p.count}
                </text>
              )}
              <path
                className={styles.linkHit}
                d={p.d}
                onClick={(e) => {
                  e.stopPropagation();
                  onLink(p.link);
                }}
              >
                <title>
                  {p.count > 1
                    ? `${p.count}: ${p.links
                        .slice(0, 4)
                        .map((l) => l.why)
                        .join('; ')}${p.count > 4 ? '; …' : ''}`
                    : p.link.why}
                </title>
              </path>
            </g>
          );
        })}
      </svg>
      {lanes.length === 0 && <p className={styles.muted}>{t('no_layers')}</p>}
      {lanes.map((lane) => {
        const groups = laneGroups.get(lane.id) ?? [];
        const shell = map.nodes.find((n) => n.detail.kind === 'shell');
        return (
          <div
            key={lane.id}
            className={cx(styles.lane, over === lane.id && styles.drop)}
            data-pmap-lane={lane.id}
            onDragOver={(e) => {
              if (!accepts(lane.id, e)) return;
              e.preventDefault();
              setOver(lane.id);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              setOver(null);
              const mfe = e.dataTransfer.getData(DRAG_MFE);
              const gear = e.dataTransfer.getData(DRAG_GEAR);
              if (lane.id === 'frontend' && mfe) onDropScreen(mfe);
              if (lane.id === 'backend' && gear) onDropGear(gear);
            }}
          >
            <div className={styles.laneHead} title={lane.hint}>
              {t(`layer_${lane.id}`)}
            </div>
            <div
              className={cx(styles.laneBody, lane.id !== 'frontend' && styles.laneRow)}
              {...(lane.id !== 'frontend' ? { 'data-pmap-row': '' } : {})}
              onScroll={measure}
            >
              {lane.id === 'frontend' ? (
                shell ? (
                  <div
                    ref={setRef(shell.id)}
                    className={cx(styles.shell, STATE_CLASS[shell.state], selected === shell.id && styles.on, linked.has(shell.id) && styles.linked)}
                    data-pmap-node={shell.id}
                    data-pmap-state={shell.state}
                  >
                    <button
                      type="button"
                      className={styles.shellHead}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(selected === shell.id ? null : shell.id);
                      }}
                      aria-expanded={selected === shell.id}
                      aria-controls="pmap-detail"
                    >
                      <b>{shell.label}</b>
                      {shell.detail.facts[1]?.startsWith('It signs') && <span className={styles.muted}> · {t('signs_in')}</span>}
                      {shell.state !== 'ok' && <span className={styles.nodeState}> {stateWord(t, shell.state)}</span>}
                    </button>
                    {app(shell, groups, t)}
                  </div>
                ) : (
                  <p
                    className={absence.tone === 'warn' && !hasFrontend ? styles.warnText : styles.muted}
                    data-pmap-frontend-absence={hasFrontend ? 'reading' : absence.tone}
                  >
                    {hasFrontend ? t('reading_frontend') : absence.text}
                    {!hasFrontend && absence.tone === 'warn' && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className={styles.linklike}
                          onClick={(e) => {
                            e.stopPropagation();
                            onFrontend();
                          }}
                        >
                          {t('open_frontend')}
                        </button>
                      </>
                    )}
                  </p>
                )
              ) : groups.length === 0 ? (
                <p className={styles.muted}>{lane.id === 'backend' ? t('backend_empty') : t('infrastructure_empty')}</p>
              ) : (
                groups.map((g) => {
                  const key = `${lane.id}:${g.group}`;
                  const folded = collapsed.has(key) && !g.nodes.some((n) => found.has(n.id));
                  const worst = g.nodes.find((n) => n.state === 'bad' || n.state === 'missing');
                  return (
                    <div
                      key={key}
                      className={cx(styles.group, folded && styles.folded)}
                      data-pmap-group={g.group}
                      style={{ '--g-h': hueOf(g.group) } as CSSProperties}
                    >
                      <button
                        type="button"
                        ref={setRef(`group:${key}`)}
                        className={cx(
                          styles.groupHead,
                          worst && styles.bad,
                          folded && g.nodes.some((n) => linked.has(n.id) || n.id === selected) && styles.linked
                        )}
                        aria-expanded={!folded}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleGroup(key);
                        }}
                        title={folded ? t('group_unfold') : t('group_fold')}
                      >
                        {folded ? '▸' : '▾'} {g.group} <span className={styles.muted}>{g.nodes.filter((n) => !n.parent).length}</span>
                      </button>
                      {!folded && (
                        <div className={styles.chips}>{g.nodes.filter((n) => !n.parent).map((n) => withChildren(n, g.nodes))}</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The key a node's group is folded under (exported for the bar's Fold all). */
export const groupKeyOf = (n: MapNode): string => `${n.layer}:${n.group}`;
