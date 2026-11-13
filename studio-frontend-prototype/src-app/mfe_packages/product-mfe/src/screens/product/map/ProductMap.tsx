/**
 * The product map (the prototype's `product-map-view.tsx`, over the model in
 * `product-map.ts`): Configure's overview and its constructor. The product's
 * frontend, backend and infrastructure as lanes of one picture, the links
 * between them drawn over it; a palette on the left adds screens, gears and
 * infra services, a panel on the right says what is selected. product.gdl is
 * its other view, the same product as text, selected together with the map.
 *
 * Adds and removes write through the product record as the sections do, so
 * the strip and every section read the same product afterwards.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from '@gears-frontx/ui-kit';
import { PRODUCT_CHANGED_EVENT, productApi } from '../../../api/client';
import type { SaveProductBody } from '../../../api/ProductApiService';
import type {
  CatalogNode,
  FrontendPick,
  GearConfigSchema,
  InfraPlan,
  InfraService,
  ProductChange,
  ProjectProduct,
  ProjectTargets,
} from '../../../api/types';
import {
  gearKey,
  librariesFrom,
  mfesFrom,
  shellsFrom,
  splitTemplates,
  type Library,
  type Mfe,
  type Shell,
} from '../../../model/frontend-constructor';
import { infraStore } from '../../../model/infra-store';
import { profilesToCheck } from '../../../model/product';
import {
  MAP_LAYERS,
  catalogueMfe,
  describedConfigs,
  frontendAbsence,
  frontendWith,
  frontendWithout,
  gearsWith,
  gearsWithout,
  problemsOf,
  productMap,
  withRequires,
  type MapLayer,
  type MapLink,
  type MapOverlay,
} from '../../../model/product-map';
import { infrastructureOf, type ProductSectionId } from '../../../model/product-sections';
import { useMapTranslations } from '../../../i18n';
import { errText, Segmented, StatusChip, useScope } from '../../common';
import { useGearCatalogue } from '../catalogue';
import { MapCanvas, groupKeyOf } from './MapCanvas';
import { Detail, GdlView, Palette, paramsOf } from './MapPanels';
import { LOOK_KEY, type MapLook } from './words';
import styles from './ProductMap.module.css';

type Read = {
  product: ProjectProduct | null;
  targets: ProjectTargets | null;
  mfes: Mfe[];
  shells: Shell[];
  libraries: Library[];
  /** The project's catalogue: what describes a gear the engine does not hold. */
  components: CatalogNode[];
  /** Why the Frontend lane is empty, when it is (`frontendAbsence`). */
  absence: { text: string; tone: 'none' | 'warn' };
  /** The project's infra services (ADR-0064) and each environment's plan for
   *  them; null and empty when they could not be read. */
  services: InfraService[] | null;
  plans: InfraPlan[];
  /** The newest saved product.gdl: the configuration as saved. */
  description: { revision: number; text: string } | null;
};

/** The bearer argument the moved-unchanged infra store still takes; `authShared()` carries the real one. */
const NO_TOKEN = '';

function storedLook(): MapLook {
  try {
    return localStorage.getItem(LOOK_KEY) === 'compact' ? 'compact' : 'subsystems';
  } catch {
    return 'subsystems';
  }
}

/** The product map: lanes, links, palette and detail, or product.gdl. */
export function ProductMap({
  onSection,
  overlay,
}: {
  /** Opens a section of the Product page: the node's detailed view. */
  onSection: (id: ProductSectionId) => void;
  /** What runs where, drawn over the nodes when given (not yet read). */
  overlay?: MapOverlay;
}) {
  const { projectId, container } = useScope();
  const { t } = useMapTranslations();
  const [read, setRead] = useState<Read | null>(null);
  // The map checks and composes for the profile the product runs as: the
  // first one bound to an environment (ADR-0057), or the deploy shape.
  const checkProfile = profilesToCheck(read?.targets?.bindings ?? [])[0];
  const [readErr, setReadErr] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  /** The product as shown: the record, or an add not yet saved. */
  const [product, setProduct] = useState<ProjectProduct | null>(null);
  const [view, setView] = useState<'map' | 'gdl'>('map');
  /** `subsystems`: each subsystem a column of cards that say what each part
   *  does; `compact`: names only. */
  const [look, setLook] = useState<MapLook>(storedLook);
  const pickLook = (l: MapLook) => {
    setLook(l);
    try {
      localStorage.setItem(LOOK_KEY, l);
    } catch {
      /* a viewer convenience only */
    }
  };
  const [layers, setLayers] = useState<Set<MapLayer>>(() => new Set(MAP_LAYERS.map((l) => l.id)));
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState<MapLink | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Find on the map: matching nodes are lit, the rest dimmed. */
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<{ after: string; changes: ProductChange[] } | null>(null);
  const catalogue = useGearCatalogue(true, projectId);
  const index = catalogue && 'index' in catalogue ? catalogue.index : null;

  useEffect(() => {
    let live = true;
    Promise.all([
      productApi.projectProduct(projectId),
      productApi.projectTargets(projectId).catch((): ProjectTargets | null => null),
      // The project's catalogue: the organization's and the project's own
      // components (ADR-0061), so a micro-frontend in its own repository is
      // found and keeps its screen previews.
      productApi.listComponents(projectId).catch(() => ({ nodes: [] as CatalogNode[] })),
      productApi.listComponentProfiles(projectId).catch(() => ({ nodes: [] as CatalogNode[] })),
      productApi.projectConfig(projectId).catch(() => null),
      productApi.productDescription(projectId).catch(() => null),
      infraStore(NO_TOKEN, projectId)
        .load()
        .then(
          (r) => r.items,
          (): InfraService[] | null => null
        ),
    ])
      .then(async ([p, targets, components, profiles, cfg, description, services]) => {
        // What a deploy to each environment does with the infra services.
        const plans = services?.length
          ? (
              await Promise.all(
                (targets?.environments ?? []).map(({ environment }) =>
                  productApi.infraPlan(projectId, environment.id).catch(() => null)
                )
              )
            ).filter((x): x is InfraPlan => !!x)
          : [];
        if (!live) return;
        const byName: Record<string, Record<string, unknown>> = {};
        for (const n of profiles.nodes ?? []) {
          const name = typeof n.value.gear_name === 'string' ? n.value.gear_name : '';
          if (name) byName[name] = n.value as Record<string, unknown>;
        }
        const nodes = components.nodes ?? [];
        const latest = description?.latest ? { revision: description.latest.revision, text: description.latest.text } : null;
        setRead({
          product: p,
          targets,
          mfes: splitTemplates(mfesFrom(nodes, byName)).addable,
          shells: shellsFrom(nodes, byName),
          libraries: librariesFrom(nodes, byName),
          components: nodes,
          absence: frontendAbsence({ picked: !!cfg?.frontend && typeof cfg.frontend === 'object', described: latest }),
          services,
          plans,
          description: latest,
        });
        setProduct(p);
        setReadErr(null);
      })
      .catch((e: unknown) => live && setReadErr(errText(e)));
    return () => {
      live = false;
    };
  }, [projectId, round]);

  // Any write to the product -- here, in a section, a check -- reads it again.
  useEffect(() => {
    const changed = (e: Event) => {
      if ((e as CustomEvent<string>).detail === projectId) setRound((r) => r + 1);
    };
    window.addEventListener(PRODUCT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PRODUCT_CHANGED_EVENT, changed);
  }, [projectId]);

  const map = useMemo(
    () =>
      read
        ? productMap({
            product,
            infra: infrastructureOf(product, read.targets),
            mfes: read.mfes,
            shells: read.shells,
            catalogue: index,
            components: read.components,
            services: read.services,
            plans: read.plans,
            environments: (read.targets?.environments ?? []).map((e) => e.environment),
            description: read.description,
          })
        : null,
    [read, product, index]
  );
  /** Each gear's and plugin's config schema, by the name the node spells it:
   *  read once for the map's gears, so a node opens with its fields. */
  const schemaAsk = useMemo(
    () =>
      [
        ...new Set(
          (map?.nodes ?? [])
            .filter((n) => (n.detail.kind === 'gear' || n.detail.kind === 'plugin') && n.detail.gear)
            .map((n) => n.detail.gear!)
        ),
      ]
        .sort()
        .join(','),
    [map]
  );
  const [schemas, setSchemas] = useState<Map<string, GearConfigSchema> | null>(null);
  useEffect(() => {
    if (!schemaAsk) return;
    let live = true;
    productApi
      .gearConfigSchemas(schemaAsk.split(','))
      .then((r) => live && setSchemas(new Map(r.items.map((s) => [s.gear, s]))))
      .catch(() => live && setSchemas(new Map()));
    return () => {
      live = false;
    };
  }, [schemaAsk]);
  const described = useMemo(() => describedConfigs(read?.description?.text ?? ''), [read]);
  const nodeById = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.id, n])), [map]);
  /** Each screen card's catalogue entry, by node: what its pictures are kept under. */
  const pictured = useMemo(() => {
    const out = new Map<string, { component: string; version: string | null }>();
    for (const place of product?.frontend?.mfes ?? []) {
      const cat = catalogueMfe(place, read?.mfes ?? []);
      if (cat) out.set(`mfe:${place.path}`, { component: cat.name, version: cat.version });
    }
    return out;
  }, [product, read]);
  const problems = useMemo(() => (map ? problemsOf(map) : []), [map]);
  const select = useCallback((id: string | null) => {
    setSelected(id);
    setLink(null);
  }, []);
  const pickLink = (l: MapLink) => {
    setLink(l);
    setSelected(null);
  };

  /* ── Writes ── */

  /** Save `body` to the product, showing `next` straight away; back to what
   *  was there if the save fails. */
  async function write(what: string, next: ProjectProduct, body: SaveProductBody) {
    const before = product;
    setBusy(what);
    setErr(null);
    setProduct(next);
    try {
      const saved = await productApi.saveProjectProduct(projectId, body);
      setProduct(saved.value);
      return saved.value;
    } catch (e) {
      setProduct(before);
      setErr(errText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Check the product as it now is, without saving a revision: the map's
   *  states follow the engine's verdict. */
  function recheck(p: ProjectProduct) {
    if (!p.product_id || !(p.gears ?? []).length) return;
    void productApi
      .previewProduct(projectId, {
        product_id: p.product_id,
        name: p.name ?? p.product_id,
        gears: p.gears ?? [],
        profile: checkProfile,
        config: p.config,
      })
      .catch(() => undefined);
  }

  async function setGears(what: string, gears: string[], offerMore: string | null) {
    const frontend = withRequires(product?.frontend, read?.mfes ?? [], gears);
    const saved = await write(
      what,
      { ...(product ?? {}), gears, ...(frontend ? { frontend } : {}) },
      { ...(product?.product_id ? { product_id: product.product_id } : {}), gears, ...(frontend ? { frontend } : {}) }
    );
    if (!saved) return;
    setSuggest(null);
    if (offerMore) {
      productApi
        .completeProduct(gears, saved.config)
        .then((r) => {
          const changes = r.changes.filter((c) => c.added && !gears.some((g) => gearKey(g) === gearKey(c.gear)));
          if (changes.length > 0) setSuggest({ after: offerMore, changes });
        })
        .catch(() => undefined);
    }
    recheck(saved);
  }

  const addGear = (name: string) => void setGears(t('busy_adding', { name }), gearsWith(product?.gears ?? [], name), name);
  const removeGear = (name: string) => void setGears(t('busy_removing', { name }), gearsWithout(product?.gears ?? [], name), null);

  async function setFrontend(what: string, frontend: FrontendPick) {
    await write(what, { ...(product ?? {}), frontend }, { frontend });
  }

  function addScreen(m: Mfe) {
    const { pick, error } = frontendWith(product?.frontend, m, read?.libraries ?? [], product?.gears ?? []);
    if (!pick) {
      setErr(error);
      return;
    }
    void setFrontend(t('busy_mounting', { name: m.name }), pick).then(() => select(`mfe:${pick.mfes[pick.mfes.length - 1].path}`));
  }

  function removeScreen(path: string) {
    if (product?.frontend) void setFrontend(t('busy_unmounting'), frontendWithout(product.frontend, path));
  }

  if (readErr) return <section className={`${styles.card} ${styles.error}`}>{t('read_failed', { error: readErr })}</section>;
  if (!read || !map) return <section className={`${styles.card} ${styles.muted}`}>{t('drawing')}</section>;

  const shown = selected ? (nodeById.get(selected) ?? null) : null;
  const engineErrors = product?.last_preview?.errors ?? 0;
  return (
    <section className={styles.card} data-product-section="map" data-product-map>
      {/* One row: the view, the look, Find, the verdict, and the rarer
          actions (layers, fold) behind the "⋯". */}
      <div className={styles.bar} data-pmap-bar>
        <Segmented
          label={t('view')}
          value={view}
          onChange={setView}
          dataAttr="data-pmap-view"
          items={[
            { id: 'map', label: t('view_map'), title: t('view_map_title') },
            { id: 'gdl', label: 'product.gdl', title: t('view_gdl_title') },
          ]}
        />
        {view === 'map' && (
          <Segmented
            label={t('look')}
            value={look}
            onChange={pickLook}
            dataAttr="data-pmap-look"
            items={[
              { id: 'subsystems', label: t('look_subsystems'), title: t('look_subsystems_title') },
              { id: 'compact', label: t('look_compact'), title: t('look_compact_title') },
            ]}
          />
        )}
        {view === 'map' && (
          <Input
            className={styles.find}
            type="search"
            placeholder={t('find')}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            aria-label={t('find')}
            data-pmap-find
          />
        )}
        <span className={styles.grow} />
        {busy && <span className={styles.muted}>{busy}</span>}
        {/* The engine's verdict is the product's, not a node's: the map names
            it and the Backend section lists it. */}
        {engineErrors > 0 && (
          <StatusChip tone="danger" onClick={() => onSection('backend')} data-pmap-engine-errors={String(engineErrors)}>
            {t('engine_errors', { count: String(engineErrors) })}
          </StatusChip>
        )}
        <StatusChip
          tone={problems.some((p) => p.node.state !== 'unused') ? 'danger' : 'ok'}
          data-pmap-problems={String(problems.length)}
        >
          {problems.length === 0 ? t('problems_none') : t('problems', { count: String(problems.length) })}
        </StatusChip>
        {view === 'map' && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" variant="ghost" title={t('menu_title')} data-pmap-menu>
                  {layers.size < MAP_LAYERS.length
                    ? t('menu_layers', { shown: String(layers.size), all: String(MAP_LAYERS.length) })
                    : '⋯'}
                </Button>
              }
            />
            <DropdownMenuContent align="end" container={container}>
              <DropdownMenuLabel>{t('layers')}</DropdownMenuLabel>
              {/* A layer's box keeps the menu open: several are often turned at once. */}
              {MAP_LAYERS.map((l) => (
                <DropdownMenuCheckboxItem
                  key={l.id}
                  checked={layers.has(l.id)}
                  closeOnClick={false}
                  onCheckedChange={() =>
                    setLayers((s) => {
                      const n = new Set(s);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      return n;
                    })
                  }
                  data-pmap-layer-toggle={l.id}
                >
                  {t(`layer_${l.id}`)}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setCollapsed(new Set(map.nodes.filter((n) => n.layer !== 'frontend').map(groupKeyOf)))}
                data-pmap-fold-all
              >
                {t('fold_all')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCollapsed(new Set())} data-pmap-unfold-all>
                {t('unfold_all')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {err && <div className={styles.error}>{err}</div>}
      {problems.length > 0 && (
        <ul className={styles.problems}>
          {problems.slice(0, 6).map((p) => (
            <li key={p.node.id}>
              <button type="button" className={styles.linklike} onClick={() => select(p.node.id)} data-pmap-problem={p.node.id}>
                <b>{p.node.label}</b> {p.text}
              </button>
            </li>
          ))}
          {problems.length > 6 && <li className={styles.muted}>{t('problems_more', { count: String(problems.length - 6) })}</li>}
        </ul>
      )}
      {suggest && (
        <div className={styles.suggest} data-pmap-suggest>
          <span className={styles.grow}>
            {t('suggest_lead', { name: suggest.after })}{' '}
            {suggest.changes.map((c, i) => (
              <span key={c.gear} title={c.reason}>
                {i > 0 && ', '}
                <b>{c.gear}</b>
              </span>
            ))}
            {t('suggest_tail')}
          </span>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void setGears(
                t('busy_adding_needs'),
                suggest.changes.reduce((gs, c) => gearsWith(gs, c.gear), product?.gears ?? []),
                null
              )
            }
          >
            {t('take_them')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSuggest(null)}>
            {t('not_now')}
          </Button>
        </div>
      )}
      <div className={styles.body}>
        <Palette
          mfes={read.mfes}
          product={product}
          catalogue={catalogue}
          infra={infrastructureOf(product, read.targets).needs}
          environments={(read.targets?.environments ?? []).map((e) => e.environment)}
          busy={!!busy}
          onAddScreen={addScreen}
          onAddGear={addGear}
        />
        {view === 'map' ? (
          <MapCanvas
            find={find}
            look={look}
            map={map}
            nodeById={nodeById}
            layers={layers}
            selected={selected}
            link={link}
            collapsed={collapsed}
            overlay={overlay}
            hasFrontend={!!product?.frontend}
            absence={read.absence}
            onFrontend={() => onSection('frontend')}
            pictured={pictured}
            onSelect={select}
            onLink={pickLink}
            onToggleGroup={(key) =>
              setCollapsed((s) => {
                const n = new Set(s);
                if (n.has(key)) n.delete(key);
                else n.add(key);
                return n;
              })
            }
            onDropScreen={(name) => {
              const m = read.mfes.find((x) => x.name === name);
              if (m) addScreen(m);
            }}
            onDropGear={addGear}
          />
        ) : (
          <GdlView
            product={product}
            profile={checkProfile}
            nodeIds={map.nodes.map((n) => n.id)}
            selected={selected}
            onSelect={select}
          />
        )}
        <Detail
          map={map}
          node={shown}
          params={shown ? paramsOf(shown, product, described, schemas, read.description?.revision ?? null) : null}
          link={link}
          nodeById={nodeById}
          product={product}
          busy={!!busy}
          view={view}
          onSelect={select}
          onLink={pickLink}
          onSection={onSection}
          onShowMap={() => setView('map')}
          onAddGear={addGear}
          onRemoveGear={removeGear}
          onRemoveScreen={removeScreen}
        />
      </div>
    </section>
  );
}
