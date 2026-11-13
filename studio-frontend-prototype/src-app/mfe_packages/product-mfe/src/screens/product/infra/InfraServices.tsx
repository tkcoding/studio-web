/**
 * Product › Infrastructure's editor (the prototype's `ProductInfraServices`,
 * infra-services-view.tsx, ADR-0064): the product's infra services as one
 * table, one row per thing that runs beside the gears — the environment's own
 * Postgres while no service gives the database, then each service. A row opens
 * to its image, its settings, its links to gear fields (Link writes
 * `${VARIABLE}` into the product's gear config) and each environment. What an
 * environment does — placement, chart, secrets, its mirror copy — is shown,
 * not edited: Releases has it. Address & files edits the project's side of a
 * service: its public address, the files its container reads (a Keycloak
 * realm to import) and extra arguments.
 *
 * Every save writes the whole list through the store (model/infra-store.ts),
 * which — as in the prototype — rewrites product.gdl's text in the browser and
 * saves it as a new description revision. That edit belongs on the server
 * (ADR-0069's backend logic-move list); the route does not exist yet.
 *
 * Not here: the product map's Infrastructure lane (`InfraLane`, with the image
 * import) is the map's; the environment form's placement field
 * (`InfraPlacementField`) is Organization › Infrastructure's; what a deploy
 * installs (`InfraPlanView`) is Releases'.
 */

import { Fragment, useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@gears-frontx/ui-kit';
import {
  productApi,
  type DeployEnvironment,
  type GearConfig,
  type InfraPassport,
  type InfraPlan,
  type InfraService,
  type ProductTechnology,
  type ProjectImage,
} from '../../../api/client';
import { gearKey } from '../../../model/frontend-constructor';
import {
  configLines,
  fileProblems,
  infraRows,
  isKeycloak,
  keycloakRealm,
  linkedConfig,
  linkRows,
  mirrorIn,
  needRows,
  offeredInfra,
  offersFor,
  parseConfigLines,
  patchPassport,
  patchService,
  unmetNeeds,
  unmetWithout,
  withKeycloakRealm,
  withoutService,
  withService,
  type InfraRow,
  type LinkRow,
} from '../../../model/infra-services';
import { INFRA_SOURCE_TEXT, infraStore, type InfraLoaded } from '../../../model/infra-store';
import { gearLabel } from '../../../model/product';
import { describedConfigs, gearConfigOf } from '../../../model/product-map';
import { useInfraTranslations } from '../../../i18n';
import { errText, openTab, StatusChip, useScope } from '../../common';
import styles from '../../product.module.css';
import own from './infra.module.css';

type Text = ReturnType<typeof useInfraTranslations>['t'];

/** One place the product runs in, as `infrastructureOf`'s `runsIn` says it. */
export interface InfraPlace {
  environment: string;
  database: string;
  missing: string[];
}

/** What the product decides about a service: the publisher image (its
 *  version) and the passport's literal config. The rest is an environment's. */
type Editing = { service: string; what: 'image' | 'config' | 'files' };

/** A question before something that cannot be undone. */
type Asking = { title: string; body: string; confirm: string; run: () => Promise<unknown> };

export function ProductInfraServices({
  needs,
  places,
  environments,
}: {
  /** The engine's needs for the profile shown; null before a check says. */
  needs: ProductTechnology[] | null;
  places: readonly InfraPlace[];
  environments: readonly DeployEnvironment[];
}) {
  const { projectId, bridge, container } = useScope();
  const { t } = useInfraTranslations();
  const [services, setServices] = useState<InfraService[] | null>(null);
  const [kept, setKept] = useState<Omit<InfraLoaded, 'items'> | null>(null);
  const [offered, setOffered] = useState<InfraPassport[]>([]);
  const [plans, setPlans] = useState<InfraPlan[]>([]);
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [configs, setConfigs] = useState<{ record: GearConfig | undefined; described: Map<string, Record<string, unknown>> }>(
    () => ({ record: undefined, described: new Map() })
  );
  const [readErr, setReadErr] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [asking, setAsking] = useState<Asking | null>(null);
  const runs = environments.filter((e) => e.kind !== 'research');
  const envIds = runs.map((e) => e.id).join(',');

  useEffect(() => {
    let live = true;
    Promise.all([
      infraStore('', projectId).load(),
      productApi.listComponents(projectId).catch(() => ({ nodes: [] })),
      productApi.projectImages(projectId, { limit: 200 }).catch(() => ({ items: [] as ProjectImage[], total: 0 })),
      productApi.projectProduct(projectId).catch(() => null),
      productApi.productDescription(projectId).catch(() => null),
      Promise.all(
        envIds
          .split(',')
          .filter(Boolean)
          .map((id) => productApi.infraPlan(projectId, id).catch(() => null))
      ),
    ])
      .then(([s, c, im, product, description, ps]) => {
        if (!live) return;
        setServices(s.items);
        setKept({ source: s.source, revision: s.revision });
        setOffered(offeredInfra(c.nodes ?? []));
        setImages(im.items);
        setConfigs({ record: product?.config, described: describedConfigs(description?.latest?.text ?? '') });
        setPlans(ps.filter((p): p is InfraPlan => !!p));
        setReadErr(null);
      })
      .catch((e) => live && setReadErr(errText(e)));
    return () => {
      live = false;
    };
  }, [projectId, envIds, round]);

  /** Write the whole list; the plans are read again, since they follow it. */
  const save = async (next: InfraService[], what: string): Promise<boolean> => {
    setBusy(what);
    setError(null);
    try {
      const saved = await infraStore('', projectId).save(next, kept?.revision ?? null);
      setServices(saved.items);
      setKept({ source: saved.source, revision: saved.revision });
      setNote(what);
      setRound((r) => r + 1);
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (readErr) return <p className={styles.error}>{t('read_failed', { error: readErr })}</p>;
  if (services === null) return <p className={styles.muted}>{t('reading_services')}</p>;

  // A passport the catalogue does not list (any more) still counts: the
  // project's service can be chosen again after it was swapped out.
  const known = [...offered, ...services.map((s) => s.passport).filter((p) => !offered.some((o) => o.name === p.name))];
  const unmet = unmetNeeds(needRows(needs ?? [], services, known, plans, places));
  const offers = offersFor(known, services, needs);
  const links = linkRows(
    needs ?? [],
    services,
    (key) => gearConfigOf(key, configs.record, configs.described).values,
    gearKey
  );
  const rows = infraRows(
    needs ?? [],
    services,
    plans,
    runs.map((e) => {
      const place = places.find((p) => p.environment === e.name);
      return { id: e.id, name: e.name, registry: e.registry, database: place?.database ?? '', missing: place?.missing ?? [] };
    }),
    links
  );
  const releases = () => openTab(bridge, 'releases');
  const addOffer = offers.find((o) => o.passport.name === adding) ?? null;

  /** Add a catalogue service; one that gives what another gives takes its
   *  place, since two may not provide the same capability. */
  const add = (p: InfraPassport): Promise<boolean> => {
    const { next, dropped } = withService(services, p);
    const run = () =>
      save(next, dropped.length ? t('added_in_place', { name: p.name, dropped: dropped.join(', ') }) : t('added', { name: p.name }));
    if (dropped.length === 0) return run();
    setAsking({
      title: t('replace_title', { name: p.name, dropped: dropped.join(', ') }),
      body: t('replace_body', { dropped: dropped.join(', ') }),
      confirm: t('replace_confirm', { name: p.name }),
      run: async () => {
        if (await run()) setAdding('');
      },
    });
    return Promise.resolve(false);
  };

  /** Link a gear field to a capability: the field reads `${VARIABLE}` in
   *  the product's configuration of the gear (product.gdl at the next save). */
  const link = async (l: LinkRow) => {
    if (!l.gear || !l.field) return;
    const key = gearKey(l.gear);
    setBusy(`link ${l.field}`);
    setError(null);
    try {
      const fresh = await productApi.projectProduct(projectId);
      const record = { ...(fresh?.config ?? {}) };
      const mine = Object.keys(record).find((g) => gearKey(g) === key) ?? key;
      // The gear's whole config as the product has it, so a field only the
      // saved product.gdl held is not lost when the record takes it over.
      const current = gearConfigOf(key, record, configs.described).values;
      record[mine] = linkedConfig(current, l.field, l.variable);
      await productApi.saveProjectProduct(projectId, { config: record });
      setNote(t('linked', { gear: gearLabel(l.gear), field: l.field, capability: l.capability }));
      setRound((r) => r + 1);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = (s: InfraService) => {
    const gone = unmetWithout(needs, services, s.passport.name);
    setAsking({
      title: t('remove_title', { name: s.passport.name }),
      body: `${
        gone.length === 0
          ? t('remove_nothing_depends')
          : gone.some((n) => n.id === 'postgres')
            ? t('remove_leaves_database', { needs: gone.map((n) => n.name).join(', ') })
            : t('remove_leaves', { needs: gone.map((n) => n.name).join(', ') })
      } ${t('remove_stays')}`,
      confirm: t('remove'),
      run: () => save(withoutService(services, s.passport.name), t('removed', { name: s.passport.name })),
    });
  };

  return (
    <div className={styles.stack} data-infra-editor>
      {unmet.length > 0 && (
        <div className={styles.row} data-infra-unmet>
          {unmet.map(({ need, offer }) => (
            <span key={need.id} className={styles.row} data-infra-unmet-need={need.id}>
              <StatusChip tone="warn">{t('no_provider', { need: need.name })}</StatusChip>
              {offer ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void add(offer)}
                  data-infra-add-offer={offer.name}
                >
                  {t('add_named', { name: offer.name })}
                </Button>
              ) : (
                <span className={styles.muted}>{t('catalogue_has_none')}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <strong>{t('runs_beside')}</strong>
        <span className={styles.grow} />
        {offers.length > 0 && (
          <span className={styles.row} data-infra-add>
            <NativeSelect
              aria-label={t('add_select_label')}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              disabled={!!busy}
            >
              <NativeSelectOption value="">{t('add_a_service')}</NativeSelectOption>
              {offers.map((o) => (
                <NativeSelectOption key={o.passport.name} value={o.passport.name}>
                  {o.passport.name}
                  {o.passport.version ? ` ${o.passport.version}` : ''}
                  {o.meets.length ? ` — ${o.meets.join(', ')}` : ''}
                  {o.replaces.length ? ` (${t('in_place_of', { names: o.replaces.join(', ') })})` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              type="button"
              size="sm"
              disabled={!addOffer || !!busy}
              onClick={() => {
                if (addOffer) void add(addOffer.passport).then((ok) => ok && setAdding(''));
              }}
            >
              {t('add')}
            </Button>
          </span>
        )}
      </div>
      <details className={`${styles.small} ${styles.muted}`}>
        <summary>{t('about')}</summary>
        <p>{t('about_links')}</p>
        <p>{t('about_environments')}</p>
        {kept && <p data-infra-source={kept.source}>{INFRA_SOURCE_TEXT[kept.source]}</p>}
      </details>
      {rows.length === 0 ? (
        <div className={styles.muted} data-infra-empty>
          <p>{needs === null ? t('needs_unknown') : t('nothing_beside')}</p>
          {needs === null && <p className={styles.small}>{t('needs_unknown_body')}</p>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_service')}</TableHead>
              <TableHead>{t('col_gives')}</TableHead>
              <TableHead>{t('col_used_by')}</TableHead>
              <TableHead>{t('col_environments')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const s = r.service;
              const isOpen = open === r.id;
              return (
                <Fragment key={r.id}>
                  <TableRow
                    className={own.clickable}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    data-infra-row={r.id}
                  >
                    <TableCell>
                      <b>{r.name}</b>
                      {r.version ? ` ${r.version}` : ''}
                      {r.description && (
                        <div className={`${styles.small} ${styles.muted} ${own.clip}`} title={r.description}>
                          {r.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={styles.row}>
                        {r.gives.map((g) => (
                          <StatusChip key={g} tone="neutral">
                            {g}
                          </StatusChip>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.usedBy.length === 0 ? (
                        <span className={styles.muted}>{t('no_gear')}</span>
                      ) : r.usedBy.length > 3 ? (
                        <StatusChip tone="neutral" title={r.usedBy.map(gearLabel).join(', ')}>
                          {t('n_gears', { count: String(r.usedBy.length) })}
                        </StatusChip>
                      ) : (
                        <span className={styles.row}>
                          {r.usedBy.map((g) => (
                            <StatusChip key={g} tone="neutral">
                              {gearLabel(g)}
                            </StatusChip>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.envs.length === 0 ? (
                        <span className={styles.muted}>{t('none_yet')}</span>
                      ) : (
                        <span className={styles.row}>
                          {r.envs.map((e) => (
                            <StatusChip
                              key={e.environment}
                              tone={e.tone}
                              title={e.detail}
                              data-infra-env={e.environment}
                              data-infra-env-tone={e.tone}
                            >
                              {e.text}
                            </StatusChip>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {s && (
                        <span className={styles.row}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ service: s.passport.name, what: 'image' })}
                          >
                            {t('change_image')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ service: s.passport.name, what: 'config' })}
                          >
                            {t('settings')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ service: s.passport.name, what: 'files' })}
                          >
                            {t('address_files')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => remove(s)}
                            data-infra-remove={s.passport.name}
                          >
                            {t('remove')}
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  {s && editing?.service === r.id && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        {editing.what === 'files' ? (
                          <FilesEditor
                            key={`${r.id}:files`}
                            service={s}
                            busy={!!busy}
                            t={t}
                            onSave={async (patch, what) => {
                              if (await save(patchService(services, r.id, patch), what)) setEditing(null);
                            }}
                            onClose={() => setEditing(null)}
                          />
                        ) : (
                          <ServiceEditor
                            key={`${r.id}:${editing.what}`}
                            service={s}
                            catalogue={offered.find((o) => o.name === r.id) ?? null}
                            what={editing.what}
                            busy={!!busy}
                            t={t}
                            onSave={async (patch, what) => {
                              if (await save(patchPassport(services, r.id, patch), what)) setEditing(null);
                            }}
                            onClose={() => setEditing(null)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <RowDetail
                          row={r}
                          images={images}
                          environments={runs}
                          busy={!!busy}
                          t={t}
                          onLink={(l) => void link(l)}
                          onReleases={releases}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
      {note && <p className={`${styles.small} ${styles.muted}`}>{note}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {asking && (
        <AlertDialog open onOpenChange={(o) => !o && !busy && setAsking(null)}>
          <AlertDialogContent container={container}>
            <AlertDialogHeader>
              <AlertDialogTitle>{asking.title}</AlertDialogTitle>
              <AlertDialogDescription>{asking.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" disabled={!!busy} onClick={() => setAsking(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={!!busy}
                data-confirm
                onClick={() => {
                  const run = asking.run;
                  setAsking(null);
                  void run();
                }}
              >
                {asking.confirm}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

const LINK_STATE: Record<LinkRow['state'], string> = {
  reference: 'link_reference',
  literal: 'link_literal',
  unset: 'link_unset',
  database: 'link_database',
  unknown: 'link_unknown',
};

/** A row opened: its image and settings, its links to gear fields, and
 *  each environment in a line. */
function RowDetail({
  row: r,
  images,
  environments,
  busy,
  t,
  onLink,
  onReleases,
}: {
  row: InfraRow;
  images: readonly ProjectImage[];
  environments: readonly DeployEnvironment[];
  busy: boolean;
  t: Text;
  onLink: (l: LinkRow) => void;
  onReleases: () => void;
}) {
  const s = r.service;
  const config = Object.entries(s?.passport.config ?? {});
  return (
    <div className={styles.stack} data-infra-detail={r.id}>
      {s && (
        <div>
          <b>{t('image')}</b> <code className={styles.code}>{s.passport.image ?? t('none')}</code>
          <div className={`${styles.small} ${styles.muted}`}>{t('image_not_locked')}</div>
        </div>
      )}
      {s && (
        <div>
          <b>{t('settings_label')}</b>{' '}
          {config.length === 0 ? (
            <span className={styles.muted}>{t('none')}</span>
          ) : (
            <span className={styles.muted}>{config.map(([k, v]) => `${k}=${v}`).join(' · ')}</span>
          )}
        </div>
      )}
      {r.links.length > 0 && (
        <div>
          <b>{t('links')}</b>
          <ul className={own.list}>
            {r.links.map((l) => (
              <li
                key={`${l.capability}:${l.field ?? ''}`}
                data-infra-link={`${l.capability}:${l.field ?? ''}`}
                data-infra-link-state={l.state}
              >
                {l.gears.length > 3 ? t('n_gears', { count: String(l.gears.length) }) : l.gears.map(gearLabel).join(', ')}
                {l.field && (
                  <>
                    {' · '}
                    <code className={styles.code}>{l.field}</code>
                  </>
                )}{' '}
                ← <code className={styles.code}>{l.capability}</code>{' '}
                <span className={l.state === 'reference' || l.state === 'database' ? undefined : styles.muted}>
                  [{t(LINK_STATE[l.state])}
                  {l.state === 'literal' && l.value ? `: ${l.value}` : ''}]
                </span>
                {l.field && (l.state === 'literal' || l.state === 'unset') && (
                  <>
                    {' '}
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onLink(l)}>
                      {t('link')}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {environments.map((e) => {
        const pill = r.envs.find((p) => p.environment === e.name);
        const copy = s ? mirrorIn([...images], s.passport.image, e.registry) : null;
        return (
          <div key={e.id} className={`${styles.small} ${styles.muted}`} data-infra-detail-env={e.name}>
            <b>{e.name}</b>: {pill?.detail ?? '—'}
            {s && (e.registry ? (copy ? ` · ${t('copy_in_registry')}` : ` · ${t('no_copy_in_registry')}`) : '')}
            {s?.public_url && ` · ${t('public_at', { url: s.public_url })}`}
            {s?.files && Object.keys(s.files).length > 0 && ` · ${t('files_mounted', { count: String(Object.keys(s.files).length) })}`}
            {s?.chart_ref && ` · ${t('ready_chart', { chart: s.chart_ref })}`}{' '}
            <button type="button" className={styles.link} onClick={onReleases}>
              {t('releases_link')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** One service's product-level settings, under its row: which publisher
 *  image (and so version) it runs, and its passport's literal config. */
function ServiceEditor({
  service: s,
  catalogue,
  what,
  busy,
  t,
  onSave,
  onClose,
}: {
  service: InfraService;
  /** The catalogue's passport of the same name: what the publisher names. */
  catalogue: InfraPassport | null;
  what: Editing['what'];
  busy: boolean;
  t: Text;
  onSave: (patch: Partial<InfraPassport>, what: string) => Promise<void>;
  onClose: () => void;
}) {
  const p = s.passport;
  const [image, setImage] = useState(p.image ?? '');
  const [text, setText] = useState(() => configLines(p.config));
  const parsed = parseConfigLines(text, p.secrets);
  const cancel = (
    <Button type="button" size="sm" variant="ghost" onClick={onClose}>
      {t('cancel')}
    </Button>
  );
  const tag = (ref: string) => ref.match(/:([^/:@]+)(@|$)/)?.[1] ?? null;
  return (
    <div className={styles.stack} data-infra-editor-panel={`${p.name}:${what}`}>
      {what === 'image' ? (
        <>
          <label className={own.field}>
            {t('image_label', { name: p.name })}
            <Input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder={catalogue?.image ?? 'quay.io/keycloak/keycloak:26.0.7'}
              aria-label={t('publisher_image')}
            />
            <span className={`${styles.small} ${styles.muted}`}>
              {catalogue?.image && catalogue.image !== image.trim() ? `${t('catalogue_names', { image: catalogue.image })} ` : ''}
              {t('image_hint')}
            </span>
          </label>
          <span className={styles.row}>
            <Button
              type="button"
              size="sm"
              disabled={busy || !image.trim() || image.trim() === (p.image ?? '')}
              onClick={() => {
                const v = tag(image.trim());
                void onSave({ image: image.trim(), ...(v ? { version: v } : {}) }, t('image_saved', { name: p.name, image: image.trim() }));
              }}
            >
              {t('save')}
            </Button>
            {catalogue?.image && catalogue.image !== (p.image ?? '') && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setImage(catalogue.image ?? '')}>
                {t('the_catalogues')}
              </Button>
            )}
            {cancel}
          </span>
        </>
      ) : (
        <>
          <label className={own.field}>
            {t('settings_of', { name: p.name })}
            <Textarea
              rows={Math.max(3, Object.keys(p.config).length + 1)}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={t('service_settings')}
            />
            <span className={`${styles.small} ${styles.muted}`}>
              {t('settings_hint', { secrets: p.secrets.join(', ') || t('none') })}
            </span>
          </label>
          {parsed.problems.map((m) => (
            <span key={m} className={styles.error}>
              {m}
            </span>
          ))}
          <span className={styles.row}>
            <Button
              type="button"
              size="sm"
              disabled={busy || parsed.problems.length > 0 || text === configLines(p.config)}
              onClick={() => void onSave({ config: parsed.config }, t('settings_saved', { name: p.name }))}
            >
              {t('save')}
            </Button>
            {catalogue && configLines(catalogue.config) !== text && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setText(configLines(catalogue.config))}>
                {t('the_catalogues')}
              </Button>
            )}
            {cancel}
          </span>
        </>
      )}
    </div>
  );
}

/** One service's project side: where people reach it, the files its
 *  container reads (path + content), and arguments after the passport's.
 *  A Keycloak gets a one-click realm to import. */
function FilesEditor({
  service: s,
  busy,
  t,
  onSave,
  onClose,
}: {
  service: InfraService;
  busy: boolean;
  t: Text;
  onSave: (patch: Pick<InfraService, 'public_url' | 'files' | 'args'>, what: string) => Promise<void>;
  onClose: () => void;
}) {
  const p = s.passport;
  const [url, setUrl] = useState(s.public_url ?? '');
  const [rows, setRows] = useState<{ path: string; content: string }[]>(() =>
    Object.entries(s.files ?? {}).map(([path, content]) => ({ path, content }))
  );
  const [argsText, setArgsText] = useState((s.args ?? []).join('\n'));
  const [portal, setPortal] = useState('');
  const files = Object.fromEntries(rows.filter((r) => r.path.trim()).map((r) => [r.path.trim(), r.content]));
  const args = argsText
    .split('\n')
    .map((a) => a.trim())
    .filter(Boolean);
  const problems = [
    ...fileProblems(files),
    ...(new Set(rows.map((r) => r.path.trim())).size < rows.length ? [t('same_path')] : []),
    ...(url.trim() && !/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url.trim()) ? [t('not_an_address', { url: url.trim() })] : []),
  ];
  const usesUrl = Object.values(p.provides).some((v) => v.includes('{public_url}'));
  const realm = isKeycloak(p) ? keycloakRealm(p, portal) : null;
  const addRealm = () => {
    const next = withKeycloakRealm({ passport: p, files, args }, portal);
    setRows(Object.entries(next.files).map(([path, content]) => ({ path, content })));
    setArgsText(next.args.join('\n'));
  };
  return (
    <div className={styles.stack} data-infra-editor-panel={`${p.name}:files`}>
      <label className={own.field}>
        {t('public_address')}
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://${p.name}.example.com`}
          aria-label={t('public_address')}
          data-infra-public-url
        />
        <span className={`${styles.small} ${styles.muted}`}>
          {t('public_address_hint', { name: p.name })} {usesUrl && t('public_address_required')}{' '}
          {t('public_address_ingress')}
        </span>
      </label>
      <div className={own.field}>
        <span>
          <b>{t('files')}</b> <span className={styles.muted}>{t('files_mounted_read_only')}</span>
        </span>
        {rows.length === 0 && <span className={styles.muted}>{t('none')}</span>}
        {rows.map((r, n) => (
          <div key={n} className={styles.stack} data-infra-file={r.path}>
            <span className={styles.row}>
              <Input
                value={r.path}
                onChange={(e) => setRows(rows.map((x, i) => (i === n ? { ...x, path: e.target.value } : x)))}
                placeholder="/etc/app/config.json"
                aria-label={t('file_path')}
                className={styles.grow}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, i) => i !== n))}>
                {t('remove')}
              </Button>
            </span>
            <Textarea
              rows={Math.min(16, Math.max(4, r.content.split('\n').length))}
              value={r.content}
              onChange={(e) => setRows(rows.map((x, i) => (i === n ? { ...x, content: e.target.value } : x)))}
              aria-label={t('file_content', { path: r.path || t('the_file') })}
              className={styles.code}
            />
          </div>
        ))}
        <span className={styles.row}>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows([...rows, { path: '', content: '' }])}>
            {t('add_file')}
          </Button>
          {realm && (
            <>
              <Input
                value={portal}
                onChange={(e) => setPortal(e.target.value)}
                placeholder={t('portal_placeholder')}
                aria-label={t('portal_address')}
              />
              <Button type="button" size="sm" variant="outline" onClick={addRealm} data-infra-keycloak-realm>
                {t('keycloak_realm')}
              </Button>
            </>
          )}
        </span>
        <span className={`${styles.small} ${styles.muted}`}>
          {t('files_hint')}
          {realm &&
            ` ${t('realm_hint', { path: realm.path, clients: realmClients(realm.content), secret: realm.secretKey })}`}
        </span>
      </div>
      <label className={own.field}>
        {t('more_arguments')}
        <Textarea rows={2} value={argsText} onChange={(e) => setArgsText(e.target.value)} aria-label={t('more_arguments')} />
        <span className={`${styles.small} ${styles.muted}`}>{t('arguments_hint', { args: p.args.join(' ') || t('none') })}</span>
      </label>
      {problems.map((m) => (
        <span key={m} className={styles.error}>
          {m}
        </span>
      ))}
      <span className={styles.row}>
        <Button
          type="button"
          size="sm"
          disabled={busy || problems.length > 0}
          onClick={() => void onSave({ public_url: url.trim() || null, files, args }, t('files_saved', { name: p.name }))}
        >
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </span>
    </div>
  );
}

/** The client ids of a realm as written, for the hint. */
function realmClients(content: string): string {
  try {
    const doc = JSON.parse(content) as { clients?: { clientId?: string }[] };
    return (doc.clients ?? []).map((c) => c.clientId).join(' & ');
  } catch {
    return '';
  }
}
