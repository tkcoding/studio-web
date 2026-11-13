/**
 * The backend's gears by group (the prototype's product-configurator-view.tsx,
 * over product-configurator.ts): the parts one can add on the left, found by
 * what they do; the product's subsystems in the middle, one zone per gear
 * `category`, each part a gear with sockets for its choices; the selected part
 * on the right, with what it is, why one adds it, its choices and its
 * settings. What the engine added by itself sits in its own zone, and one line
 * on top says what is left to do.
 *
 * Every gear reads in plain words: the organization's explanation when it has
 * one (`/studio-product/v1/gear-explanations`), else its gear.gdl description.
 * A model writes one on the person's own key, a person can edit it, and
 * "Explain all" fills in every gear that says nothing yet.
 */

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Badge, Button, Input, Textarea } from '@gears-frontx/ui-kit';
import { responseStatus, violationOfType } from '@constructor-studio/mfe-shared';
import { productApi, type GearConfig, type ProductPreview } from '../../../api/client';
import { gearDeployState, type GearDeployState, type ProductAt, type Running } from '../../../model/gear-deploys-model';
import { gearLabel } from '../../../model/product';
import {
  choosePlugin,
  compose,
  gearFacts,
  inBatches,
  offers,
  plainWords,
  readinessBreakdown,
  removePart,
  subsystemOf,
  subsystemReadiness,
  subsystems,
  todos,
  unexplained,
  type BatchResult,
  type CatalogueIndex,
  type GearOrigin,
  type Part,
  type Readiness,
} from '../../../model/product-configurator';
import { useConfiguratorTranslations } from '../../../i18n';
import { errText } from '../../common';
import { BringsWithIt } from './BringsWithIt';
import { GearConfigForm } from './GearConfigForm';
import { useGearExplanations, type Explanations } from './hooks';
import common from '../../product.module.css';
import styles from './configurator.module.css';

type Text = ReturnType<typeof useConfiguratorTranslations>['t'];

/** What the map needs of the project's product. */
export interface ConfiguredProduct {
  picks: string[];
  config: GearConfig;
  setPicks: (update: (current: string[]) => string[]) => void;
  setField: (gear: string, field: string, value: unknown) => void;
  toggle: (name: string) => void;
  /** Start from these picks, completed by the engine into a set that resolves. */
  seed: (picks: string[]) => Promise<void>;
}

/** Whose a part is, in a tooltip. */
const ORIGIN_TITLE: Record<GearOrigin, string> = {
  project: 'origin_project_title',
  organization: 'origin_organization_title',
  platform: 'origin_platform_title',
};

/** Why a gear could not be explained, for a person. */
function explainError(e: unknown, t: Text): string {
  if (responseStatus(e) === 403) return t('explain_forbidden');
  if (violationOfType(e, 'PROVIDER_KEY_REQUIRED')) return t('explain_needs_key');
  if (violationOfType(e, 'EXPLANATION_EDITED')) return t('explain_edited');
  return errText(e);
}

export function ProductConfigurator({
  index,
  product,
  preview,
  stale,
  busy,
  kept,
  running,
  productAt,
  focus,
}: {
  index: CatalogueIndex;
  product: ConfiguredProduct;
  /** The engine's last answer about this product, if any. */
  preview: Pick<ProductPreview, 'gears' | 'ok' | 'diagnostics' | 'applications' | 'profile'> | null;
  /** The answer is about a product that has changed since. */
  stale: boolean;
  busy: boolean;
  /** The Domain entities each gear keeps, by engine id (useKeptEntities). */
  kept?: Map<string, string[]>;
  /** What each environment runs now (useRunning); absent or null: unknown. */
  running?: Running[] | null;
  /** The product the runs are measured against: its last commit and change. */
  productAt?: ProductAt;
  /** A gear to open, with its settings: a fix that asks for them. */
  focus?: { name: string; at: number } | null;
}) {
  const { t } = useConfiguratorTranslations();
  const { picks, config } = product;
  const explanations = useGearExplanations();
  // The part picked here, and the focus it was picked over: a newer focus
  // from a fix wins over it.
  const [picked, setPicked] = useState<{ name: string | null; seen: number }>({ name: null, seen: 0 });
  const selected = focus && focus.at > picked.seen ? focus.name : picked.name;
  const setSelected = (name: string | null) => setPicked({ name, seen: focus?.at ?? 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const composition = useMemo(() => compose(index, picks, config, preview), [index, picks, config, preview]);
  const zones = useMemo(() => subsystems(index), [index]);
  const ready = useMemo(() => subsystemReadiness(index), [index]);
  const left = todos(composition);
  const chosen = composition.parts.find((p) => p.name === selected) ?? null;
  const deployOf = (p: Part): GearDeployState | null => gearDeployState(p, running ?? null, productAt);

  const add = (name: string) => {
    if (busy || picks.includes(name)) return;
    setSelected(name);
    // Completion fills the new part's slots and brings what it needs.
    void product.seed([...picks, name]);
  };
  const targetZone = dragging ? subsystemOf(index.find(dragging) ?? {}) : null;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null);
    if (name) add(name);
  };

  // Only zones with a part in them, plus the one a dragged part would land in.
  const shown = zones.filter((z) => z === targetZone || composition.parts.some((p) => p.category === z));
  const errors = preview?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;

  return (
    <div className={common.stack} data-configurator>
      <div className={styles.status} role="status">
        {composition.parts.length === 0 ? (
          <Badge variant="secondary">{t('status_empty')}</Badge>
        ) : left.length > 0 ? (
          <>
            <Badge variant="warning">{t.count('status_todo', left.length)}</Badge>
            <ul>
              {left.map((item) => (
                <li key={item.text}>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(item.part)}>
                    {item.text}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : preview && !stale && !preview.ok ? (
          <>
            <Badge variant="warning">{t('status_cannot_build')}</Badge>
            <span>{t.count('status_problems', errors)}</span>
          </>
        ) : preview && !stale && preview.ok ? (
          <Badge variant="success">{t('status_ready')}</Badge>
        ) : (
          <Badge variant="secondary">{busy ? t('status_checking') : t('status_unchecked')}</Badge>
        )}
        <span className={common.muted}>
          {t('status_summary', {
            parts: String(composition.parts.length),
            automatic: String(composition.automatic.length),
          })}
          {preview && !stale && preview.applications.length > 0
            ? ` · ${t('status_runs_as', { count: String(preview.applications.length), profile: preview.profile })}`
            : ''}
        </span>
      </div>

      <div className={styles.work}>
        <Palette index={index} product={product} explanations={explanations} onAdd={add} onDrag={setDragging} t={t} />

        <div className={styles.box}>
          <div className={styles.h}>
            {/* The backend's gears by group; the whole product -- frontend,
                backend and infrastructure -- is the Map section. */}
            {t('gears_by_group')}
            <span className={styles.legend} aria-label={t('origin_legend')}>
              <span>{t('origin_project')}</span>
              <span>{t('origin_organization')}</span>
              <span>{t('origin_platform')}</span>
            </span>
          </div>
          <div
            className={`${styles.zones}${dragging ? ` ${styles.zonesOver}` : ''}`}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={onDrop}
            data-zones
          >
            {shown.length === 0 && (
              <div className={`${styles.zone} ${styles.zoneTarget}`}>
                <div className={common.muted}>{t('zones_empty')}</div>
              </div>
            )}
            {shown.map((z) => {
              const parts = composition.parts.filter((p) => p.category === z);
              return (
                <section
                  key={z}
                  className={`${styles.zone}${z === targetZone ? ` ${styles.zoneTarget}` : ''}`}
                  data-zone={z}
                  aria-label={z}
                >
                  <header>
                    <b>{z}</b>
                    <span>{parts.length || ''}</span>
                    <ReadyPill r={ready.get(z)} t={t} />
                  </header>
                  {parts.length === 0 && <div className={common.muted}>{t('zone_drop')}</div>}
                  {parts.map((p) => (
                    <Tile
                      key={p.name}
                      part={p}
                      origin={index.origin(index.find(p.name))}
                      keeps={kept?.get(p.id)}
                      words={plainWords(index.find(p.name), explanations.byId)}
                      deploy={deployOf(p)}
                      selected={p.name === selected}
                      onSelect={() => setSelected(p.name)}
                      t={t}
                    />
                  ))}
                </section>
              );
            })}
            {composition.automatic.length > 0 && (
              <section className={styles.zone} aria-label={t('added_for_you')}>
                <header>
                  <b>{t('added_for_you')}</b>
                  <span>{composition.automatic.length}</span>
                </header>
                {composition.automatic.map((a) => (
                  <div key={a.id} className={`${styles.tile} ${styles.auto}`} title={a.why}>
                    <b>⚙ {a.label}</b>
                    <small>{a.why}</small>
                  </div>
                ))}
              </section>
            )}
          </div>
          {composition.unknown.length > 0 && (
            <p className={`${common.muted} ${common.small}`} data-unknown>
              {t('unknown_left_out')}{' '}
              {composition.unknown.map((n) => (
                <span key={n}>
                  <code className={common.code}>{gearLabel(n)}</code>{' '}
                  <button type="button" className={common.link} onClick={() => product.toggle(n)}>
                    {t('remove')}
                  </button>{' '}
                </span>
              ))}
            </p>
          )}
        </div>

        <Inspector
          index={index}
          part={chosen}
          keeps={chosen ? kept?.get(chosen.id) : undefined}
          deploy={chosen ? deployOf(chosen) : null}
          product={product}
          explanations={explanations}
          busy={busy}
          onRemove={(p) => {
            setSelected(null);
            product.setPicks((current) => removePart(current, p));
          }}
          t={t}
        />
      </div>
    </div>
  );
}

/** "Keeps: Project, Workspace and 2 more": the Domain entities a part stores. */
function keepsLine(keeps: string[], t: Text, max = 3): string {
  const shown = keeps.slice(0, max).join(', ');
  return keeps.length > max ? t('keeps_more', { shown, more: String(keeps.length - max) }) : shown;
}

function Tile({
  part,
  origin,
  keeps,
  words,
  deploy,
  selected,
  onSelect,
  t,
}: {
  part: Part;
  /** Whose the gear is: the map colours the project's and the organization's own. */
  origin: GearOrigin;
  keeps?: string[];
  /** The gear in plain words: its explanation, else its description. */
  words: string | null;
  /** Where it runs; null when that is not known. */
  deploy: GearDeployState | null;
  selected: boolean;
  onSelect: () => void;
  t: Text;
}) {
  const open = part.unset.length > 0 || part.slots.some((s) => s.chosen.length === 0 || s.unset.length > 0);
  return (
    <button
      type="button"
      className={`${styles.tile} ${styles[`origin_${origin}`]}${selected ? ` ${styles.tileSelected}` : ''}`}
      onClick={onSelect}
      data-part={part.name}
      data-origin={origin}
      title={t(ORIGIN_TITLE[origin])}
    >
      {open && <span className={styles.flag} title={t('needs_you')} />}
      <b>⚙ {part.label}</b>
      <small>{words ?? (part.plugsInto ? t('plugs_into', { host: part.plugsInto }) : gearLabel(part.name))}</small>
      {keeps && keeps.length > 0 && (
        <small data-keeps title={t('keeps_title', { entities: keeps.join(', ') })}>
          <b>{t('keeps')}</b> {keepsLine(keeps, t)}
        </small>
      )}
      {deploy && (
        <small data-runs={deploy.runs.length > 0 ? 'yes' : 'no'} title={deploy.hint ?? deploy.line}>
          {deploy.hint && '⚠ '}
          {deploy.runs.length > 0
            ? t('runs_in', { environments: deploy.runs.map((r) => r.environment).join(', ') })
            : t('not_deployed')}
        </small>
      )}
      {part.slots.length > 0 && (
        <span className={styles.sockets}>
          {part.slots.map((s) => {
            const c = s.options.find((o) => o.name === s.chosen[0]);
            return (
              <span key={s.key} className={`${styles.socket}${c ? '' : ` ${styles.socketEmpty}`}`} title={s.label}>
                {c ? c.label : t('choose_slot', { slot: s.label })}
              </span>
            );
          })}
        </span>
      )}
    </button>
  );
}

/** How far a subsystem of the catalogue is towards v1, from its gears' maturity. */
function ReadyPill({ r, t }: { r: Readiness | undefined; t: Text }) {
  if (!r) return null;
  return (
    <span
      className={styles.ready}
      data-ready={r.percent}
      title={t('ready_title', { gears: String(r.gears), breakdown: readinessBreakdown(r) })}
    >
      {t('ready', { percent: String(r.percent) })}
    </span>
  );
}

function Palette({
  index,
  product,
  explanations,
  onAdd,
  onDrag,
  t,
}: {
  index: CatalogueIndex;
  product: ConfiguredProduct;
  explanations: Explanations;
  onAdd: (name: string) => void;
  onDrag: (name: string | null) => void;
  t: Text;
}) {
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<string | null>(null);
  const [looking, setLooking] = useState<string | null>(null);
  const all = offers(index, product.picks, query);
  const ready = useMemo(() => subsystemReadiness(index), [index]);
  const groups = only ? all.filter((g) => g.category === only) : all;
  return (
    <div className={styles.box} aria-label={t('palette')} data-palette>
      <div className={styles.h}>{t('palette')}</div>
      <ExplainAll index={index} explanations={explanations} t={t} />
      <Input
        type="search"
        placeholder={t('palette_find_placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t('palette_find')}
      />
      <div className={styles.chips}>
        {[null, ...all.map((g) => g.category)].map((c) => (
          <Button
            key={c ?? '*'}
            type="button"
            size="sm"
            variant={only === c ? 'secondary' : 'ghost'}
            aria-pressed={only === c}
            onClick={() => setOnly(c)}
          >
            {c ?? t('all')}
          </Button>
        ))}
      </div>
      {groups.length === 0 && <div className={common.muted}>{t('palette_nothing')}</div>}
      {groups.map((g) => (
        <div key={g.category} className={common.stack}>
          {!only && (
            <div className={styles.h}>
              {g.category} <ReadyPill r={ready.get(g.category)} t={t} />
            </div>
          )}
          {g.items.map((o) => {
            const gear = index.find(o.name);
            const origin = index.origin(gear);
            return (
              <div
                key={o.name}
                className={`${styles.offer} ${styles[`origin_${origin}`]}`}
                data-origin={origin}
                title={t(ORIGIN_TITLE[origin])}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', o.name);
                  e.dataTransfer.effectAllowed = 'copy';
                  onDrag(o.name);
                }}
                onDragEnd={() => onDrag(null)}
                data-offer={o.name}
              >
                <b>⚙ {o.label}</b>
                <Button type="button" size="sm" variant="outline" onClick={() => onAdd(o.name)}>
                  {t('add')}
                </Button>
                <p>
                  {plainWords(gear, explanations.byId) || (gear ? gearFacts(index, gear).join(' ') : '') || gearLabel(o.name)}
                  {o.maturity && o.maturity !== 'stable' ? ` · ${o.maturity}` : ''}{' '}
                  <button
                    type="button"
                    className={common.link}
                    onClick={() => setLooking(looking === o.name ? null : o.name)}
                  >
                    {t('comes_with_it')}
                  </button>
                </p>
                {looking === o.name && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <BringsWithIt
                      key={o.name}
                      picks={product.picks}
                      config={product.config}
                      candidate={o.name}
                      onClose={() => setLooking(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Inspector({
  index,
  part,
  keeps,
  deploy,
  product,
  explanations,
  busy,
  onRemove,
  t,
}: {
  index: CatalogueIndex;
  part: Part | null;
  keeps?: string[];
  deploy: GearDeployState | null;
  product: ConfiguredProduct;
  explanations: Explanations;
  busy: boolean;
  onRemove: (part: Part) => void;
  t: Text;
}) {
  if (!part) {
    return (
      <div className={styles.box} aria-label={t('inspector')} data-inspector>
        <div className={styles.h}>{t('how_it_works')}</div>
        <ol className={`${styles.bullets} ${common.muted}`}>
          <li>{t('how_1')}</li>
          <li>{t('how_2')}</li>
          <li>{t('how_3')}</li>
          <li>{t('how_4')}</li>
        </ol>
      </div>
    );
  }
  const gear = index.find(part.name);
  const facts = gear ? gearFacts(index, gear) : [];
  const own = [part.name, ...part.slots.flatMap((s) => s.chosen)];
  const scoped = {
    picks: own,
    config: Object.fromEntries(Object.entries(product.config).filter(([k]) => own.includes(k))),
    setField: product.setField,
  };
  return (
    <div className={styles.box} aria-label={t('about', { part: part.label })} data-inspector={part.name}>
      <b>⚙ {part.label}</b>
      <div className={`${common.muted} ${common.small}`}>
        {part.category}
        {part.maturity && part.maturity !== 'stable' ? ` · ${part.maturity}` : ''} ·{' '}
        <code className={common.code}>{gearLabel(part.name)}</code>
      </div>
      {deploy && (
        <div data-deploy>
          <span className={`${common.muted} ${common.small}`}>
            {deploy.line[0].toUpperCase() + deploy.line.slice(1)}.
          </span>
          {deploy.hint && (
            <div className={`${common.error} ${common.small}`} data-deploy-hint>
              {deploy.hint}
            </div>
          )}
        </div>
      )}
      <Explanation key={part.id} gearId={part.id} description={part.description} explanations={explanations} t={t} />
      {keeps && keeps.length > 0 && (
        <div data-keeps>
          <b>{t('keeps')}</b> {keeps.join(', ')}
          <span className={`${common.muted} ${common.small}`}> — {t('keeps_from_model')}</span>
        </div>
      )}
      {facts.length > 0 && (
        <ul className={styles.facts}>
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {part.plugsInto && <div>{t('plugs_into_comes', { host: part.plugsInto })}</div>}
      {part.slots.map((s) => (
        <section key={s.key} className={common.stack} data-slot={s.label}>
          <b>{s.label}</b>
          {s.options.length === 0 && <div className={common.error}>{t('slot_nothing')}</div>}
          {s.options.map((o) => {
            const words = plainWords(index.find(o.name), explanations.byId);
            return (
              <label key={o.name} className={styles.choice}>
                <input
                  type="radio"
                  name={`${part.name}-${s.key}`}
                  checked={s.chosen.includes(o.name)}
                  disabled={busy}
                  onChange={() => product.setPicks((current) => choosePlugin(current, s, o.name))}
                />
                <span>
                  <b>{o.label}</b>
                  {o.name === s.recommended && <em className={common.muted}> {t('recommended')}</em>}
                </span>
                {words && <small>{words}</small>}
              </label>
            );
          })}
        </section>
      ))}
      <section className={common.stack}>
        <b>{t('settings')}</b>
        <GearConfigForm product={scoped} />
      </section>
      <div className={common.row}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={styles.pushRight}
          disabled={busy}
          onClick={() => onRemove(part)}
        >
          {t('remove_from_product')}
        </Button>
      </div>
    </div>
  );
}

/** A gear in plain words, in the Inspector: what it says now and who wrote
 *  it, "Explain in plain words" (a model, on the person's key) and "Edit". */
function Explanation({
  gearId,
  description,
  explanations,
  t,
}: {
  gearId: string;
  description: string | null;
  explanations: Explanations;
  t: Text;
}) {
  const kept = explanations.byId.get(gearId) ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = kept?.text.trim() || description;

  const generate = async () => {
    // A person's words are replaced only when they say so.
    const force = kept?.source === 'edited';
    if (force && !window.confirm(t('explain_replace_confirm'))) return;
    setWorking(true);
    setError(null);
    try {
      explanations.put(await productApi.generateGearExplanation(gearId, force));
    } catch (e) {
      setError(explainError(e, t));
    } finally {
      setWorking(false);
    }
  };
  const save = async () => {
    setWorking(true);
    setError(null);
    try {
      explanations.put(await productApi.updateGearExplanation(gearId, draft));
      setEditing(false);
    } catch (e) {
      setError(explainError(e, t));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className={common.stack} data-explanation={gearId}>
      {editing ? (
        <>
          <Textarea
            aria-label={t('explain_label')}
            rows={4}
            maxLength={1200}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('explain_placeholder')}
          />
          <div className={common.row}>
            <Button type="button" size="sm" disabled={working || !draft.trim()} onClick={() => void save()}>
              {working ? t('saving') : t('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.why}>{words ?? t('explain_none')}</div>
      )}
      {!editing && (
        <div className={`${common.row} ${common.small}`}>
          {kept && (
            <span className={common.muted} data-source={kept.source}>
              {kept.source === 'edited' ? t('written_by_person') : t('written_by_model')}
            </span>
          )}
          {/* Changing them is an organization admin's; everyone reads. */}
          {explanations.mayManage && (
            <>
              <button type="button" className={common.link} disabled={working} onClick={() => void generate()}>
                {working ? t('explaining') : kept ? t('explain_again') : t('explain')}
              </button>
              <button
                type="button"
                className={common.link}
                disabled={working}
                onClick={() => {
                  setDraft(words ?? '');
                  setEditing(true);
                }}
              >
                {t('edit')}
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className={`${common.error} ${common.small}`}>{error}</div>}
    </div>
  );
}

/** How many gears are explained at once by "Explain all". */
const EXPLAIN_AT_ONCE = 3;

/** "Explain all without description": a model explains every gear that says
 *  nothing yet, three at a time, with progress and a way to stop. */
function ExplainAll({ index, explanations, t }: { index: CatalogueIndex; explanations: Explanations; t: Text }) {
  const left = useMemo(() => unexplained(index, explanations.byId), [index, explanations.byId]);
  const [run, setRun] = useState<{ total: number; progress: BatchResult; stopping: boolean } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const stop = useRef(false);

  const start = async () => {
    const gears = left;
    stop.current = false;
    setSaid(null);
    setRun({ total: gears.length, progress: { done: 0, failed: 0, skipped: 0 }, stopping: false });
    let firstError: string | null = null;
    const result = await inBatches(
      gears,
      EXPLAIN_AT_ONCE,
      async (g) => {
        try {
          explanations.put(await productApi.generateGearExplanation(g.id));
        } catch (e) {
          firstError ??= explainError(e, t);
          // Without a key every other gear fails the same way: stop asking.
          if (violationOfType(e, 'PROVIDER_KEY_REQUIRED')) stop.current = true;
          throw e;
        }
      },
      {
        stop: () => stop.current,
        onProgress: (progress) => setRun((r) => (r ? { ...r, progress } : r)),
      }
    );
    setRun(null);
    const parts = [t('explained', { done: String(result.done), total: String(gears.length) })];
    if (result.failed > 0)
      parts.push(
        firstError
          ? t('explained_failed_why', { failed: String(result.failed), error: firstError })
          : t('explained_failed', { failed: String(result.failed) })
      );
    if (result.skipped > 0) parts.push(t('explained_skipped', { skipped: String(result.skipped) }));
    setSaid(parts.join(' '));
  };

  if (!run && left.length === 0 && !said) return null;
  return (
    <div className={`${common.stack} ${common.small}`} data-explain-all>
      {run ? (
        <div className={common.row}>
          <progress
            max={run.total}
            value={run.progress.done + run.progress.failed}
            aria-label={t('explaining_gears')}
            className={common.grow}
          />
          <span>
            {run.progress.done + run.progress.failed} / {run.total}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={run.stopping}
            onClick={() => {
              stop.current = true;
              setRun((r) => (r ? { ...r, stopping: true } : r));
            }}
          >
            {run.stopping ? t('stopping') : t('stop')}
          </Button>
        </div>
      ) : (
        left.length > 0 &&
        explanations.mayManage && (
          <Button type="button" size="sm" variant="outline" onClick={() => void start()}>
            {t('explain_all', { count: String(left.length) })}
          </Button>
        )
      )}
      {said && <span className={common.muted}>{said}</span>}
      {explanations.error && !run && (
        <span className={common.muted}>{t('explanations_failed', { error: explanations.error })}</span>
      )}
    </div>
  );
}
