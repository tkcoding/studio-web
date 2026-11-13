/**
 * Project domain model › Entities (the prototype's `ModelMapView` in
 * domain-model-screens.tsx): what the application is, in three layers
 * (Domain, System, Deployment), as a table or as a diagram of entity cards
 * and the relations the documents declare. The panel beside it shows the
 * entity pointed at or picked: its definition, the gear that keeps it, its
 * neighbourhood, its facts with their review, and the editor that saves a
 * correction to docs/domain-model.md.
 */

import {
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Button, Input, Textarea } from '@gears-frontx/ui-kit';
import type { SpecModelEntityEdit, SpecModelWrite } from '../../api/types';
import {
  cardFields,
  cardSize,
  entityDraft,
  LAYER_TITLE,
  LAYER_WHAT,
  layerOf,
  placeCards,
  relationEdges,
  weight,
  type DiagramEdge,
  type Layer,
  type PlacedCard,
} from '../../model/domain-layers';
import { findEntities, mapEdges, neighbours, type MapEdge } from '../../model/domain-model-views';
import { entityGears, type GearRef, type Keeper } from '../../model/entity-gears';
import { FactReviewContext } from '../../model/review-state';
import { PROVISIONAL_NOTE } from '../../model/saved-entities';
import { factsByKind, type Entity, type SpecModelFact } from '../../model/spec-model';
import { useEntitiesTranslations } from '../../i18n';
import { DataTable } from '../common/DataTable';
import { FactRow, SideLink, type OpenFile } from '../common/facts';
import { EmptyState, errText, InfoPopover, Segmented } from '../common/ui';
import common from '../common/common.module.css';
import styles from './entities.module.css';

type Text = ReturnType<typeof useEntitiesTranslations>['t'];

/** How many entities a layer's diagram shows at first: few enough to read. */
const SHOW_STEPS = [25, 40, 80, Infinity] as const;

/** What the overview can narrow a layer to. */
type Only = 'unrelated' | 'unkept';

export function EntitiesView({
  entities,
  onOpenFile,
  onSave,
  saved = new Map(),
  gears,
}: {
  entities: Entity[];
  onOpenFile: OpenFile;
  /** Save an edited entity to the project's documentation. */
  onSave?: (edit: SpecModelEntityEdit) => Promise<SpecModelWrite>;
  /** What was saved this visit, by key: shown until the next build reads it. */
  saved?: Map<string, SpecModelWrite>;
  /** The gears that could keep a Domain entity; null while unknown, so no gap is claimed. */
  gears?: GearRef[] | null;
}) {
  const { t } = useEntitiesTranslations();
  const [layer, setLayer] = useState<Layer>('domain');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // The entity the pointer is on: the panel shows it until one is picked.
  const [peek, setPeek] = useState<string | null>(null);
  // Where the panel came from, newest last, for its Back.
  const [back, setBack] = useState<string[]>([]);
  const [only, setOnly] = useState<Only | null>(null);
  // A table first: thousands of entities read as rows, not as a drawing.
  const [mode, setMode] = useState<'diagram' | 'list'>('list');
  const [show, setShow] = useState<number>(25);
  const [mentions, setMentions] = useState(false);

  const layerOfKey = useMemo(() => new Map(entities.map((e) => [e.key, layerOf(e)])), [entities]);
  const counts = useMemo(() => {
    const c: Record<Layer, number> = { domain: 0, system: 0, deployment: 0 };
    let hidden = 0;
    for (const l of layerOfKey.values()) {
      if (l) c[l]++;
      else hidden++;
    }
    return { ...c, hidden };
  }, [layerOfKey]);
  const relations = useMemo(() => relationEdges(entities), [entities]);
  const relationCount = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of relations) {
      out.set(r.from, (out.get(r.from) ?? 0) + 1);
      out.set(r.to, (out.get(r.to) ?? 0) + 1);
    }
    return out;
  }, [relations]);
  // Only what the product is about is kept by a gear; System and Deployment
  // entities are the gears and where they run.
  const keepers = useMemo(
    () => (gears ? entityGears(entities.filter((e) => layerOfKey.get(e.key) === 'domain'), gears).byEntity : null),
    [entities, gears, layerOfKey]
  );
  const inLayer = useMemo(() => entities.filter((e) => layerOfKey.get(e.key) === layer), [entities, layer, layerOfKey]);
  const pool = useMemo(
    () =>
      findEntities(entities, query).filter(
        (e) =>
          layerOfKey.get(e.key) === layer &&
          (only !== 'unrelated' || !relationCount.get(e.key)) &&
          (only !== 'unkept' || (keepers !== null && !keepers.get(e.key)))
      ),
    [entities, query, layer, layerOfKey, only, relationCount, keepers]
  );
  const shown = useMemo(() => [...pool].sort((a, b) => weight(b) - weight(a)).slice(0, show), [pool, show]);
  const allMentions = useMemo(
    () => (mentions ? mapEdges(entities).filter((e) => e.kind === 'mentions') : []),
    [entities, mentions]
  );
  const edges = useMemo(() => {
    const keep = new Set(shown.map((e) => e.key));
    const rel = relations.filter((e) => keep.has(e.from) && keep.has(e.to));
    const men = allMentions.filter(
      (e) =>
        keep.has(e.from) &&
        keep.has(e.to) &&
        !rel.some((r) => (r.from === e.from && r.to === e.to) || (r.from === e.to && r.to === e.from))
    );
    return { rel, men };
  }, [shown, relations, allMentions]);
  const sel = entities.find((e) => e.key === (selected ?? peek)) ?? null;
  const pinned = !!selected && sel?.key === selected;
  /** Open `k` in the panel, keeping where it came from for Back. */
  const open = (k: string | null) => {
    if (selected && k !== selected) setBack((b) => [...b.slice(-19), selected]);
    if (k) {
      const l = layerOfKey.get(k);
      if (l && l !== layer) setLayer(l);
    }
    setSelected(k);
  };
  const goBack = () => {
    const prev = back[back.length - 1];
    setBack((b) => b.slice(0, -1));
    if (!prev) return;
    const l = layerOfKey.get(prev);
    if (l && l !== layer) setLayer(l);
    setSelected(prev);
  };
  const onlyTitle = (o: Only) => t(o === 'unrelated' ? 'only_unrelated' : 'only_unkept');

  if (entities.length === 0) return <EmptyState title={t('nothing_read')} body={t('nothing_read_body')} />;

  return (
    <div className={common.stack} data-entities>
      <p className={common.hint}>
        <b>{t('howto')}</b> <InfoPopover label={t('how_to_read')}>{t('howto_more')}</InfoPopover>
      </p>
      <div className={styles.layers} role="tablist" aria-label={t('layer')}>
        {(Object.keys(LAYER_TITLE) as Layer[]).map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={layer === l}
            className={`${styles.layer} ${styles[`layer_${l}`]} ${layer === l ? styles.on : ''}`}
            onClick={() => {
              setLayer(l);
              setSelected(null);
              setOnly(null);
              setBack([]);
            }}
          >
            <b>{LAYER_TITLE[l]}</b> <span className={common.count}>{counts[l]}</span>
            <small>{LAYER_WHAT[l]}</small>
          </button>
        ))}
      </div>
      <p className={common.hint}>{t('left_out', { n: counts.hidden })}</p>
      <div className={styles.map}>
        <div className={common.card}>
          <div className={common.row}>
            <Input
              type="search"
              className={styles.find}
              placeholder={t('find')}
              aria-label={t('find')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {mode === 'diagram' && (
              <>
                <Segmented
                  role="group"
                  label={t('how_many')}
                  value={String(show)}
                  onChange={(v) => setShow(Number(v))}
                  items={SHOW_STEPS.map((n) => ({
                    id: String(n),
                    label: n === Infinity ? t('show_all') : n === 25 ? t('show_main') : String(n),
                  }))}
                />
                <label className={common.hint}>
                  <input type="checkbox" checked={mentions} onChange={(e) => setMentions(e.target.checked)} />{' '}
                  {t('show_mentions')}
                </label>
              </>
            )}
            <Segmented
              role="group"
              label={t('how_to_show')}
              value={mode}
              onChange={setMode}
              items={[
                { id: 'list', label: t('table') },
                { id: 'diagram', label: t('diagram') },
              ]}
            />
            {only && (
              <Button type="button" size="sm" variant="outline" onClick={() => setOnly(null)} title={t('whole_layer')}>
                {onlyTitle(only)} ×
              </Button>
            )}
            <span className={common.hint} style={{ marginLeft: 'auto' }}>
              {t.count('shown_of', edges.rel.length, { shown: shown.length, pool: pool.length })}
            </span>
          </div>
          {mode === 'diagram' ? (
            <Diagram
              entities={shown}
              layer={layer}
              relations={edges.rel}
              mentions={edges.men}
              selected={selected}
              onSelect={open}
              onPeek={setPeek}
            />
          ) : (
            <DataTable<Entity>
              list="dm-entities"
              urlPrefix="ent."
              rows={pool}
              rowKey={(e) => e.key}
              rowLabel={(e) => e.name}
              pageSize={20}
              onOpen={(e) => open(e.key)}
              onPeek={(e) => setPeek(e?.key ?? null)}
              empty={{ title: only ? t('none_only', { what: onlyTitle(only).toLowerCase() }) : t('none_matches') }}
              columns={[
                {
                  id: 'name',
                  header: t('col_entity'),
                  compare: (a, b) => a.name.localeCompare(b.name),
                  cell: (e) => <b className={e.key === selected ? styles.picked : undefined}>{e.name}</b>,
                },
                {
                  id: 'facts',
                  header: t('col_facts'),
                  num: true,
                  compare: (a, b) => a.facts.length - b.facts.length,
                  cell: (e) => e.facts.length,
                },
                {
                  id: 'docs',
                  header: t('col_documents'),
                  num: true,
                  compare: (a, b) => a.documents - b.documents,
                  cell: (e) => e.documents,
                },
                {
                  id: 'relations',
                  header: t('col_relations'),
                  num: true,
                  compare: (a, b) => (relationCount.get(a.key) ?? 0) - (relationCount.get(b.key) ?? 0),
                  cell: (e) => relationCount.get(e.key) ?? 0,
                },
                {
                  id: 'keeper',
                  header: t('col_kept_by'),
                  cell: (e) => {
                    const k = keepers?.get(e.key);
                    return k ? k.gear.label : <span className={common.muted}>—</span>;
                  },
                },
              ]}
            />
          )}
          {mode === 'diagram' && (
            <div className={styles.legend}>
              <span>
                <svg viewBox="0 0 26 8" width="26" height="8" aria-hidden="true">
                  <line x1="0" y1="4" x2="26" y2="4" className={`${styles.edge} ${styles.relation}`} />
                </svg>{' '}
                {t('legend_relation')}
              </span>
              {mentions && (
                <span>
                  <svg viewBox="0 0 26 8" width="26" height="8" aria-hidden="true">
                    <line x1="0" y1="4" x2="26" y2="4" className={`${styles.edge} ${styles.mentions}`} />
                  </svg>{' '}
                  {t('legend_mentions')}
                </span>
              )}
              <span className={common.hint}>{t('legend_zoom')}</span>
            </div>
          )}
        </div>
        <aside
          className={`${common.card} ${styles.panel} ${sel && !pinned ? styles.peek : ''}`}
          aria-label={t('selected_entity')}
          data-entity-panel={sel?.key ?? ''}
        >
          {sel && (
            <div className={common.row}>
              {pinned ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={back.length === 0}
                    onClick={goBack}
                    title={
                      back.length
                        ? t('back_to', { name: entities.find((e) => e.key === back[back.length - 1])?.name ?? '' })
                        : t('nothing_back')
                    }
                  >
                    ← {t('back')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelected(null);
                      setBack([]);
                    }}
                    title={t('unpin_title')}
                  >
                    {t('unpin')} ×
                  </Button>
                </>
              ) : (
                <span className={common.hint}>{t('preview')}</span>
              )}
            </div>
          )}
          {sel ? (
            <EntityCard
              key={sel.key}
              entity={sel}
              names={entities.filter((e) => layerOfKey.get(e.key)).map((e) => e.name)}
              saved={sel.keys.map((k) => saved.get(k)).find((w) => !!w) ?? null}
              onSave={onSave}
              layer={layerOfKey.get(sel.key) ?? null}
              keeper={keepers?.get(sel.key)}
              related={relations
                .filter((r) => r.from === sel.key || r.to === sel.key)
                .map((r) => ({ other: entities.find((e) => e.key === (r.from === sel.key ? r.to : r.from)), verbs: r.verbs }))
                .filter((r): r is { other: Entity; verbs: string[] } => !!r.other)}
              onSelect={open}
              onOpenFile={onOpenFile}
            />
          ) : (
            <LayerOverview
              t={t}
              layer={layer}
              entities={inLayer}
              relationCount={relationCount}
              keepers={keepers}
              only={only}
              onOnly={setOnly}
              onSelect={open}
              onPeek={setPeek}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function Diagram({
  entities,
  layer,
  relations,
  mentions,
  selected,
  onSelect,
  onPeek,
}: {
  entities: Entity[];
  layer: Layer;
  relations: DiagramEdge[];
  mentions: MapEdge[];
  selected: string | null;
  onSelect: (k: string | null) => void;
  onPeek?: (k: string | null) => void;
}) {
  const { t } = useEntitiesTranslations();
  const cards = useMemo(
    () =>
      entities.map((e) => {
        const fields = cardFields(e);
        return { key: e.key, name: e.name, fields, ...cardSize(e.name, fields) };
      }),
    [entities]
  );
  const placed = useMemo(() => placeCards(cards, relations), [cards, relations]);
  const at = useMemo(() => new Map(placed.cards.map((c) => [c.key, c])), [placed]);
  const near = selected ? new Set([selected, ...neighbours(selected, relations)]) : null;
  const few = entities.length <= 25;

  // Start on the whole drawing, with a margin, at the frame's proportions.
  const fit = useMemo(() => {
    const pad = 40;
    const w = placed.width + 2 * pad;
    const h = placed.height + 2 * pad;
    const ratio = 900 / 620;
    return w / h > ratio
      ? { x: -pad, y: -pad - (w / ratio - h) / 2, w, h: w / ratio }
      : { x: -pad - (h * ratio - w) / 2, y: -pad, w: h * ratio, h };
  }, [placed]);
  // The view a person moved to, for the drawing it was moved on; another
  // drawing starts on its own fit (the prototype reset it in an effect).
  const [moved, setMoved] = useState<{ fit: typeof fit; view: typeof fit } | null>(null);
  const view = moved && moved.fit === fit ? moved.view : fit;
  const setView = (next: typeof fit | ((v: typeof fit) => typeof fit)) =>
    setMoved((m) => {
      const current = m && m.fit === fit ? m.view : fit;
      return { fit, view: typeof next === 'function' ? next(current) : next };
    });
  const svg = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const units = (px: number) => (svg.current && svg.current.clientWidth ? px * (view.w / svg.current.clientWidth) : px);
  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const w = Math.min(fit.w * 2, Math.max(fit.w / 8, view.w * f));
    const h = (w / view.w) * view.h;
    const px = view.x + ((e.clientX - box.left) / box.width) * view.w;
    const py = view.y + ((e.clientY - box.top) / box.height) * view.h;
    setView({ x: px - ((px - view.x) * w) / view.w, y: py - ((py - view.y) * h) / view.h, w, h });
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
    const dx = units(e.clientX - d.x);
    const dy = units(e.clientY - d.y);
    setView((v) => ({ ...v, x: d.vx - dx, y: d.vy - dy }));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(null);
  };

  // A line leaves a card at its centre and bends a little, so two lines
  // between neighbours do not lie on each other.
  const curve = (a: PlacedCard, b: PlacedCard) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2 - (dy / len) * 0.12 * len;
    const my = (a.y + b.y) / 2 + (dx / len) * 0.12 * len;
    return {
      d: `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`,
      lx: (a.x + b.x) / 2 - (dy / len) * 0.06 * len,
      ly: (a.y + b.y) / 2 + (dx / len) * 0.06 * len,
    };
  };

  return (
    <svg
      ref={svg}
      className={styles.diagram}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="img"
      aria-label={t('diagram_label', { layer: LAYER_TITLE[layer] })}
      data-diagram
    >
      {mentions.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return null;
        const cold = !!near && !(near.has(e.from) && near.has(e.to));
        return (
          <path key={`m${e.from}|${e.to}`} d={curve(a, b).d} className={`${styles.edge} ${styles.mentions} ${cold ? styles.cold : ''}`} />
        );
      })}
      {relations.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return null;
        const hot = !!selected && (e.from === selected || e.to === selected);
        return (
          <path
            key={`r${e.from}|${e.to}`}
            d={curve(a, b).d}
            className={`${styles.edge} ${styles.relation} ${hot ? styles.hot : selected ? styles.cold : ''}`}
          />
        );
      })}
      {placed.looseTop !== null && (
        <text x={0} y={placed.looseTop} className={styles.loose}>
          {t('not_related_yet')}
        </text>
      )}
      {placed.cards.map((c) => {
        const card = cards.find((x) => x.key === c.key)!;
        const cold = !!near && !near.has(c.key);
        return (
          <g
            key={c.key}
            transform={`translate(${c.x - c.w / 2},${c.y - c.h / 2})`}
            className={`${styles.node} ${styles[`layer_${layer}`]} ${c.key === selected ? styles.sel : ''} ${cold ? styles.cold : ''}`}
            onPointerDown={(ev) => ev.stopPropagation()}
            onMouseEnter={() => onPeek?.(c.key)}
            onMouseLeave={() => onPeek?.(null)}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(c.key === selected ? null : c.key);
            }}
            role="button"
            tabIndex={0}
            aria-label={card.name}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onSelect(c.key);
              }
            }}
          >
            <rect className={styles.box} width={c.w} height={c.h} rx={8} />
            <rect className={styles.band} x={1} y={1} width={c.w - 2} height={28} rx={7} />
            <rect className={styles.stripe} x={8} y={6} width={4} height={18} rx={2} />
            <text className={styles.title} x={18} y={19}>
              {card.name}
            </text>
            {card.fields.map((f, i) => (
              <text key={f} className={styles.field} x={12} y={46 + 16 * i}>
                • {f}
              </text>
            ))}
          </g>
        );
      })}
      {relations.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b || e.verbs.length === 0) return null;
        const hot = !!selected && (e.from === selected || e.to === selected);
        if (!few && !hot) return null;
        const { lx, ly } = curve(a, b);
        return (
          <text key={`l${e.from}|${e.to}`} x={lx} y={ly} className={styles.verb} textAnchor="middle">
            {e.verbs.slice(0, 2).join(' / ')}
          </text>
        );
      })}
    </svg>
  );
}

function EntityCard({
  entity,
  layer,
  related,
  names,
  saved,
  onSave,
  onSelect,
  onOpenFile,
  keeper,
}: {
  entity: Entity;
  layer: Layer | null;
  /** The gear that keeps it; null when none does; undefined when not asked. */
  keeper?: Keeper | null;
  related: { other: Entity; verbs: string[] }[];
  names: string[];
  saved: SpecModelWrite | null;
  onSave?: (edit: SpecModelEntityEdit) => Promise<SpecModelWrite>;
  onSelect: (k: string) => void;
  onOpenFile: OpenFile;
}) {
  const { t } = useEntitiesTranslations();
  const definition = entity.facts.find((f) => f.kind === 'entity');
  const [editing, setEditing] = useState(false);
  const review = useContext(FactReviewContext);
  const reviewable = entity.facts.filter((f) => !f.provisional);
  const proposed = review ? reviewable.filter((f) => !review.stateOf(f)) : [];
  const rejected = review ? review.rejectedOf(entity.keys) : [];
  if (editing && onSave)
    return <EntityEditor entity={entity} names={names} onSave={onSave} onDone={() => setEditing(false)} />;
  return (
    <>
      <div>
        <div className={common.row}>
          {layer && <span className={`${styles.pill} ${styles[`layer_${layer}`]}`}>{LAYER_TITLE[layer]}</span>}
          {onSave && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              style={{ marginLeft: 'auto' }}
              onClick={() => setEditing(true)}
              title={t('edit_title')}
            >
              {t('edit')}
            </Button>
          )}
        </div>
        <h3 className={styles.name}>{entity.name}</h3>
        {saved && <SavedNote saved={saved} />}
        <div className={common.hint}>
          {t.count('facts_from', entity.documents, { facts: entity.facts.length })}
          {review && ` · ${t('accepted_proposed', { accepted: reviewable.length - proposed.length, proposed: proposed.length })}`}
        </div>
        {review && proposed.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void review.review(proposed, 'accepted')}
            title={t('accept_all_title')}
          >
            {t('accept_all', { n: proposed.length })}
          </Button>
        )}
      </div>
      {definition && (
        <blockquote className={common.quote}>
          {definition.text}
          {definition.provisional && <span className={common.status}>{PROVISIONAL_NOTE}</span>}
        </blockquote>
      )}
      {keeper && (
        <div className={styles.keeper} data-keeper={keeper.gear.id}>
          {t('kept_by')} <b>{keeper.gear.label}</b>
          {keeper.gear.origin === 'project' ? ` ${t('this_projects_gear')}` : ''}
          <small>{keeper.why}</small>
        </div>
      )}
      {related.length > 0 && <Neighbourhood t={t} entity={entity} related={related} onSelect={onSelect} />}
      {related.length > 0 && (
        <section className={styles.rels}>
          <b>{t('how_it_relates')}</b>
          {related.map((r) => (
            <div key={r.other.key}>
              <b className={styles.verbText} title={r.verbs.join(' / ')}>
                {r.verbs.length > 3 ? `${r.verbs.slice(0, 3).join(' / ')} …` : r.verbs.join(' / ') || t('relates_to')}
              </b>{' '}
              <button type="button" className={common.link} onClick={() => onSelect(r.other.key)}>
                {r.other.name}
              </button>
            </div>
          ))}
        </section>
      )}
      <FactsFiltered facts={entity.facts.filter((f) => f !== definition && f.kind !== 'relation')} onOpenFile={onOpenFile} />
      {review && rejected.length > 0 && (
        <details className={common.kind}>
          <summary>{t.count('rejected_readings', rejected.length)}</summary>
          {rejected.map((f, i) => (
            <div key={i} className={`${common.fact} ${common.factRejected}`}>
              <div>
                {f.aspect && <span className={common.aspect}>{f.aspect}: </span>}
                {f.value || f.text}{' '}
                <button type="button" className={common.link} onClick={() => void review.review([f], 'proposed')}>
                  {t('put_back')}
                </button>
              </div>
              <SideLink side={f.source} onOpenFile={onOpenFile} />
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/** The layer at a glance, while nothing is picked: what is most described
 *  and most related, and what is loose -- each a way into the table. */
function LayerOverview({
  t,
  layer,
  entities,
  relationCount,
  keepers,
  only,
  onOnly,
  onSelect,
  onPeek,
}: {
  t: Text;
  layer: Layer;
  entities: Entity[];
  relationCount: Map<string, number>;
  keepers: Map<string, Keeper | null> | null;
  only: Only | null;
  onOnly: (o: Only | null) => void;
  onSelect: (k: string) => void;
  onPeek: (k: string | null) => void;
}) {
  const top = (by: (e: Entity) => number) =>
    [...entities].sort((a, b) => by(b) - by(a) || a.name.localeCompare(b.name)).slice(0, 6);
  const connected = top((e) => relationCount.get(e.key) ?? 0).filter((e) => relationCount.get(e.key));
  const described = top((e) => e.facts.length);
  const unrelated = entities.filter((e) => !relationCount.get(e.key)).length;
  const unkept = layer === 'domain' && keepers ? entities.filter((e) => !keepers.get(e.key)).length : null;
  const chips = (list: Entity[], n: (e: Entity) => number) => (
    <div className={common.row}>
      {list.map((e) => (
        <button
          key={e.key}
          type="button"
          className={styles.chip}
          onClick={() => onSelect(e.key)}
          onMouseEnter={() => onPeek(e.key)}
          onMouseLeave={() => onPeek(null)}
        >
          {e.name} <span className={common.muted}>{n(e)}</span>
        </button>
      ))}
    </div>
  );
  const cut = (o: Only, count: number, what: string) => (
    <Button
      type="button"
      size="sm"
      variant={only === o ? 'secondary' : 'outline'}
      aria-pressed={only === o}
      onClick={() => onOnly(only === o ? null : o)}
      disabled={count === 0}
    >
      <b>{count}</b> {what}
    </Button>
  );
  return (
    <div className={common.stack} data-dm-overview={layer}>
      <span className={`${styles.pill} ${styles[`layer_${layer}`]}`}>{LAYER_TITLE[layer]}</span>
      <p className={common.muted}>{LAYER_WHAT[layer]}.</p>
      <b>{t('most_related')}</b>
      {connected.length ? (
        chips(connected, (e) => relationCount.get(e.key) ?? 0)
      ) : (
        <p className={common.hint}>{t('no_relation_in_layer')}</p>
      )}
      <b>{t('most_described')}</b>
      {chips(described, (e) => e.facts.length)}
      <b>{t('loose_ends')}</b>
      <div className={common.row}>
        {cut('unrelated', unrelated, t('cut_unrelated'))}
        {unkept !== null && cut('unkept', unkept, t('cut_unkept'))}
      </div>
      <p className={common.hint}>{t('point_at_row')}</p>
    </div>
  );
}

/** The entity in the middle and what it relates to around it, each line
 *  named by its verb. A neighbour opens on click. */
function Neighbourhood({
  t,
  entity,
  related,
  onSelect,
}: {
  t: Text;
  entity: Entity;
  related: { other: Entity; verbs: string[] }[];
  onSelect: (k: string) => void;
}) {
  const [on, setOn] = useState<string | null>(null);
  const shown = related.slice(0, 10);
  const W = 300;
  const H = shown.length > 6 ? 220 : 180;
  const cx = W / 2;
  const cy = H / 2;
  const rx = W / 2 - 52;
  const ry = H / 2 - 22;
  const at = shown.map((r, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / shown.length;
    return { ...r, x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return (
    <svg className={styles.ego} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('ego_label', { name: entity.name })}>
      {at.map((n) => (
        <g key={`l:${n.other.key}`} className={`${styles.egoEdge} ${on === n.other.key ? styles.egoOn : ''}`}>
          <line x1={cx} y1={cy} x2={n.x} y2={n.y} />
          {(on === n.other.key || shown.length <= 4) && n.verbs[0] && (
            <text x={(cx + n.x) / 2} y={(cy + n.y) / 2 - 3} textAnchor="middle">
              {clip(n.verbs[0], 18)}
            </text>
          )}
        </g>
      ))}
      <g className={styles.egoMe}>
        <rect x={cx - 56} y={cy - 13} width={112} height={26} rx={13} />
        <text x={cx} y={cy + 4} textAnchor="middle">
          {clip(entity.name, 16)}
        </text>
      </g>
      {at.map((n) => (
        <g
          key={n.other.key}
          className={`${styles.egoNode} ${on === n.other.key ? styles.egoOn : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`${n.verbs[0] ?? t('relates_to')} ${n.other.name}`}
          onMouseEnter={() => setOn(n.other.key)}
          onMouseLeave={() => setOn(null)}
          onFocus={() => setOn(n.other.key)}
          onBlur={() => setOn(null)}
          onClick={() => onSelect(n.other.key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(n.other.key);
            }
          }}
        >
          <title>{`${n.verbs.join(' / ') || t('relates_to')} ${n.other.name}`}</title>
          <rect x={n.x - 46} y={n.y - 11} width={92} height={22} rx={11} />
          <text x={n.x} y={n.y + 4} textAnchor="middle">
            {clip(n.other.name, 14)}
          </text>
        </g>
      ))}
      {related.length > shown.length && (
        <text className={styles.egoMore} x={W - 4} y={H - 4} textAnchor="end">
          {t('more_below', { n: related.length - shown.length })}
        </text>
      )}
    </svg>
  );
}

/** An entity's facts by kind, narrowed by a word and by kind. */
function FactsFiltered({ facts, onOpenFile }: { facts: SpecModelFact[]; onOpenFile: OpenFile }) {
  const { t } = useEntitiesTranslations();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const groups = factsByKind(facts);
  const needle = q.trim().toLowerCase();
  const matches = (f: SpecModelFact) =>
    !needle || [f.text, f.value, f.aspect, f.source.path].some((s) => (s ?? '').toLowerCase().includes(needle));
  const title = (k: string) => {
    const key = `kind_${k}`;
    const said = t(key);
    return said === key || said.endsWith(`:${key}`) ? k : said;
  };
  if (facts.length === 0) return null;
  return (
    <div className={common.stack}>
      {facts.length > 6 && (
        <div className={common.row}>
          <Input
            type="search"
            className={styles.find}
            placeholder={t('find_in_facts')}
            aria-label={t('find_in_facts')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {groups.map((g) => (
            <Button
              key={g.kind}
              type="button"
              size="sm"
              variant={kind === g.kind ? 'secondary' : 'ghost'}
              aria-pressed={kind === g.kind}
              onClick={() => setKind(kind === g.kind ? null : g.kind)}
            >
              {title(g.kind)} <span className={common.count}>{g.facts.length}</span>
            </Button>
          ))}
        </div>
      )}
      {groups
        .filter((g) => !kind || g.kind === kind)
        .map((g) => ({ ...g, facts: g.facts.filter(matches) }))
        .filter((g) => g.facts.length > 0)
        .map((g) => (
          <section key={g.kind} className={common.kind}>
            <h3>{title(g.kind)}</h3>
            {g.facts.map((f, i) => (
              <FactRow key={i} fact={f} onOpenFile={onOpenFile} />
            ))}
          </section>
        ))}
      {needle && groups.every((g) => !g.facts.some(matches)) && <p className={common.hint}>{t('no_fact_says', { q: q.trim() })}</p>}
    </div>
  );
}

/** Where a saved edit went, and when the model will show it. */
function SavedNote({ saved }: { saved: SpecModelWrite }) {
  const { t } = useEntitiesTranslations();
  return (
    <div className={styles.saved} data-saved={saved.path}>
      ✓ {t('saved_to')} <code>{saved.path}</code>{' '}
      {saved.pr_url ? (
        <a href={saved.pr_url} target="_blank" rel="noreferrer">
          {t('as_pull_request')}
        </a>
      ) : (
        t('on_branch', { branch: saved.branch })
      )}
      . {t('read_next_build')}
    </div>
  );
}

/** Correct an entity: what it is, what it holds, how it relates. Saved as
 *  its section of docs/domain-model.md, the way the repository takes changes. */
function EntityEditor({
  entity,
  names,
  onSave,
  onDone,
}: {
  entity: Entity;
  names: string[];
  onSave: (edit: SpecModelEntityEdit) => Promise<SpecModelWrite>;
  onDone: () => void;
}) {
  const { t } = useEntitiesTranslations();
  const [draft, setDraft] = useState(() => entityDraft(entity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = `dm-names-${entity.key.replace(/\W+/g, '-')}`;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: draft.name,
        definition: draft.definition.trim() || null,
        fields: draft.fields.filter((f) => f.name.trim()),
        relations: draft.relations.filter((r) => r.verb.trim() && r.target.trim()),
      });
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={common.stack}
      data-entity-editor
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <b>{t('edit_name', { name: entity.name })}</b>
      <p className={common.hint}>{t('editor_where')}</p>
      <label className={styles.field2}>
        <span>{t('what_it_is')}</span>
        <Textarea
          rows={3}
          value={draft.definition}
          onChange={(e) => setDraft({ ...draft, definition: e.target.value })}
          placeholder={t('definition_placeholder', { name: entity.name })}
        />
      </label>
      <div className={styles.field2}>
        <span>{t('what_it_holds')}</span>
        {draft.fields.map((f, i) => (
          <div key={i} className={styles.row2}>
            <Input
              aria-label={t('field')}
              value={f.name}
              placeholder={t('field')}
              onChange={(e) =>
                setDraft({ ...draft, fields: draft.fields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
              }
            />
            <Input
              aria-label={t('what_it_holds')}
              value={f.meaning}
              placeholder={t('what_it_holds_placeholder')}
              onChange={(e) =>
                setDraft({ ...draft, fields: draft.fields.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)) })
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('remove_field')}
              onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}
            >
              ×
            </Button>
          </div>
        ))}
        <button
          type="button"
          className={common.link}
          onClick={() => setDraft({ ...draft, fields: [...draft.fields, { name: '', meaning: '' }] })}
        >
          + {t('field')}
        </button>
      </div>
      <div className={styles.field2}>
        <span>{t('how_it_relates')}</span>
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {draft.relations.map((r, i) => (
          <div key={i} className={styles.row2}>
            <Input
              aria-label={t('verb')}
              value={r.verb}
              placeholder={t('verb_placeholder')}
              onChange={(e) =>
                setDraft({ ...draft, relations: draft.relations.map((x, j) => (j === i ? { ...x, verb: e.target.value } : x)) })
              }
            />
            <Input
              aria-label={t('entity')}
              list={listId}
              value={r.target}
              placeholder={t('entity')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  relations: draft.relations.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)),
                })
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('remove_relation')}
              onClick={() => setDraft({ ...draft, relations: draft.relations.filter((_, j) => j !== i) })}
            >
              ×
            </Button>
          </div>
        ))}
        <button
          type="button"
          className={common.link}
          onClick={() => setDraft({ ...draft, relations: [...draft.relations, { verb: '', target: '' }] })}
        >
          + {t('relation')}
        </button>
      </div>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      <div className={common.actions}>
        <Button type="submit" disabled={busy}>
          {busy ? t('saving') : t('save_to_docs')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
