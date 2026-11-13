/**
 * The Product page's Frontend constructor (ADR-0050; the prototype's
 * frontend-constructor-view.tsx): the product's UI as a FrontX shell with
 * micro-frontends mounted in it. Above, the steps a build of it takes — the
 * shell, the micro-frontends, their FrontX versions, sign-in, the backend, the
 * gears behind the screens, build, ship — each with what the constructor
 * found. Below, the packages one can add on the left, from the catalogue; the
 * shell in the middle, drawn as the portal draws it — navigation, the page,
 * the sidebar, overlays and popups — filled with the screens the picked
 * packages bring; the selected package on the right, with the gears it calls
 * and whether the product has them. The model is `frontend-constructor.ts`;
 * the sentences it composes (steps, placements, the summary) stay English.
 *
 * The pick is kept with the product (`frontend` of its record), and its
 * product.gdl says it as `frontend = frontx_product(...)`. A project that
 * picked before keeps `project.config.frontend`, read until the first save.
 */

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import { productApi, type ScreenPreview } from '../../../api/client';
import { repoPathsOf } from '../../../model/builds';
import {
  FRONTX_SHELL_TEMPLATE,
  assemblySteps,
  chosenShell,
  coverage,
  fitOf,
  frontendPick,
  frontxSuggestion,
  librariesFrom,
  mfesFrom,
  offersFor,
  picksOf,
  placementLabel,
  projectRepos,
  shellRefOf,
  shellsFrom,
  splitTemplates,
  stepsSummary,
  withFrontxSource,
  zonesOf,
  type Library,
  type Mfe,
  type Placement,
  type Shell,
  type ShellPassport,
  type Step,
} from '../../../model/frontend-constructor';
import { pictureOf, previewBuild, shortCommit, type PreviewBuild } from '../../../model/screen-previews';
import { useFrontendTranslations } from '../../../i18n';
import { errText, StatusChip, useScope, type Tone } from '../../common';
import { loadFrontxDefaults, useFrontxDefaults } from './frontxDefaults';
import common from '../../product.module.css';
import styles from './FrontendConstructor.module.css';

type Text = ReturnType<typeof useFrontendTranslations>['t'];

type Loaded = {
  /** The micro-frontends a product can add. */
  mfes: Mfe[];
  /** Templates and examples: where a new micro-frontend starts. */
  templates: Mfe[];
  /** Packages micro-frontends share: brought along when the shell lacks them. */
  libraries: Library[];
  gears: string[];
  /** The shells in the catalogue: what a frontend can be assembled on. */
  shells: Shell[];
  /** The project's repository to read micro-frontends from, when the catalogue does not read it yet. */
  suggestion: string | null;
};

type Shot = { shot: ScreenPreview; build: PreviewBuild };

/** A lucide icon id (`lucide:users`) as one letter in a circle: the shell's
 *  icons are not bundled here, and a letter says which item it is. */
function Glyph({ icon, label }: { icon: string | null; label: string }) {
  const letter = (icon?.split(':').pop() ?? label).slice(0, 1).toUpperCase();
  return (
    <span className={styles.glyph} aria-hidden="true">
      {letter}
    </span>
  );
}

/** Each package's pictures, read once per page: a build adds them, and a
 *  reload is when a reader expects to see a new one. */
const pictures = new Map<string, Promise<ScreenPreview[]>>();

/** For tests: forget the pictures read. */
export function forgetPictures(): void {
  pictures.clear();
}

/** The build whose pictures each of `mfes` shows, by package name: `null`
 *  while reading and for a package no build pictured at its catalogue version. */
function usePictureBuilds(mfes: readonly Mfe[]): Map<string, PreviewBuild | null> {
  const ask = mfes.map((m) => m.name).join(',');
  const [items, setItems] = useState<Map<string, ScreenPreview[]>>(() => new Map());
  useEffect(() => {
    if (!ask) return;
    let live = true;
    for (const name of ask.split(',')) {
      let read = pictures.get(name);
      if (!read) {
        read = productApi.screenPreviews(name).then(
          (r) => r.items ?? [],
          (): ScreenPreview[] => []
        );
        pictures.set(name, read);
      }
      void read.then((r) => {
        if (live) setItems((m) => (m.get(name) === r ? m : new Map(m).set(name, r)));
      });
    }
    return () => {
      live = false;
    };
  }, [ask]);
  return useMemo(() => {
    const out = new Map<string, PreviewBuild | null>();
    for (const m of mfes) {
      const got = items.get(m.name);
      out.set(m.name, got ? previewBuild(got, m.version) : null);
    }
    return out;
  }, [items, mfes]);
}

/** A screen's picture, larger, over the page. */
function ShotDialog({ shot, build, onClose, t }: Shot & { onClose: () => void; t: Text }) {
  const { container } = useScope();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent container={container} size="lg" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{shot.label ?? shot.route}</DialogTitle>
        </DialogHeader>
        <div className={common.row}>
          <code className={common.code}>{shot.route}</code>
          <span className={common.muted}>
            {shot.component}
            {build.version ? `@${build.version}` : ''} · {t('built_at', { commit: shortCommit(build.commit) })}
          </span>
        </div>
        <img className={styles.shotBig} src={shot.image} alt={shot.label ?? shot.route} />
      </DialogContent>
    </Dialog>
  );
}

export function FrontendConstructor() {
  const { projectId, orgId } = useScope();
  const { t } = useFrontendTranslations();
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  /** Whether the product record keeps the frontend, which is what its
   *  product.gdl is written from; a pick from before is only in the project configuration. */
  const [inProduct, setInProduct] = useState(false);
  /** The shell it is assembled on, as `github:owner/repo//dir@ref`. */
  const [shellRef, setShellRef] = useState<string>(FRONTX_SHELL_TEMPLATE);
  const [savedShell, setSavedShell] = useState<string>(FRONTX_SHELL_TEMPLATE);
  /** The step whose detail is open; `null` shows them all folded. */
  const [openStep, setOpenStep] = useState<Step['id'] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped to read the catalogue again, after the suggested source synced. */
  const [loads, setLoads] = useState(0);
  /** Where adding the suggested FrontX source has got to; `null` when idle. */
  const [suggesting, setSuggesting] = useState<string | null>(null);
  /** The product's gears no picked screen calls, listed on demand. */
  const [showUnseen, setShowUnseen] = useState(false);
  const frontx = useFrontxDefaults();

  useEffect(() => {
    let alive = true;
    Promise.all([
      productApi.listComponents(projectId),
      productApi.listComponentProfiles(projectId).catch(() => ({ nodes: [] })),
      productApi.projectProduct(projectId).catch(() => null),
      productApi.projectConfig(projectId).catch(() => null),
      productApi.listArtifactNodes('repo', projectId, undefined, 50).catch(() => ({ nodes: [] })),
      productApi.catalogSources().catch(() => ({ items: [] })),
      productApi.getProjectGearRepo(projectId).catch(() => ({ nodes: [] })),
      loadFrontxDefaults(),
    ])
      .then(([components, profiles, product, cfg, repos, sources, gearRepo, defaults]) => {
        if (!alive) return;
        const byName: Record<string, Record<string, unknown>> = {};
        for (const n of profiles.nodes ?? []) {
          const name = typeof n.value.gear_name === 'string' ? n.value.gear_name : '';
          if (name) byName[name] = n.value as Record<string, unknown>;
        }
        const all = mfesFrom(components.nodes ?? [], byName);
        const { addable, templates } = splitTemplates(all, defaults.source.repo);
        setData({
          mfes: addable,
          templates,
          libraries: librariesFrom(components.nodes ?? [], byName),
          gears: product?.gears ?? [],
          shells: shellsFrom(components.nodes ?? [], byName),
          suggestion: frontxSuggestion(
            projectRepos({
              gearRepo: gearRepo.nodes?.[0]?.value.repo,
              sources: cfg?.sources,
              writtenPrUrl: product?.written?.pr_url,
              artifactRepos: [...repoPathsOf(repos.nodes ?? []).values()],
            }),
            sources.items ?? []
          ),
        });
        // The product's own record first; a project that picked before it
        // kept one has its picks in the project configuration.
        const kept = product?.frontend ? picksOf(product.frontend, all) : null;
        setInProduct(!!kept);
        const own = kept?.picks ?? cfg?.frontend?.mfes ?? [];
        setPicks(own);
        setSaved(own);
        const shell = kept?.shellRef ?? cfg?.frontend?.shell ?? defaults.shellTemplate;
        setShellRef(shell);
        setSavedShell(shell);
      })
      .catch((e: unknown) => alive && setErr(errText(e)));
    return () => {
      alive = false;
    };
  }, [projectId, loads]);

  /** Add `repo` to the organization's catalogue sources as FrontX (unless it
   *  is there already) and sync them, the way a scheduled sync does: no body,
   *  so the run reads every stored source. */
  async function addSource(repo: string) {
    setErr(null);
    setSuggesting(t('adding_source'));
    try {
      const { items } = await productApi.catalogSources();
      const next = withFrontxSource(items ?? [], repo);
      if (next) await productApi.saveCatalogSources(next);
      setSuggesting(t('syncing'));
      const { run_id } = await productApi.syncComponents();
      const deadline = Date.now() + 10 * 60 * 1000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        // The sync is queued in the organization on screen: its run is read there.
        const run = await productApi.componentsCatalogTask(run_id, orgId);
        if (run.status === 'succeeded') break;
        if (run.status === 'failed' || run.status === 'cancelled')
          throw new Error(run.message || t('sync_ended', { status: run.status }));
        if (Date.now() > deadline) throw new Error(t('sync_still_running'));
        setSuggesting(t('syncing_at', { what: (run.message || run.status).replace(/…$/, '') }));
      }
      setSuggesting(null);
      setLoads((n) => n + 1);
    } catch (e) {
      setSuggesting(null);
      setErr(errText(e));
    }
  }

  const picked = useMemo(
    () => (data ? picks.map((n) => data.mfes.find((m) => m.name === n)).filter((m): m is Mfe => !!m) : []),
    [data, picks]
  );
  const zones = useMemo(() => zonesOf(picked), [picked]);
  const cover = useMemo(() => coverage(picked, data?.gears ?? []), [picked, data]);
  const shell = useMemo(() => chosenShell(data?.shells ?? [], shellRef), [data, shellRef]);
  const steps = useMemo(
    () => assemblySteps({ shellRef, shell, picked, productGears: data?.gears ?? [] }),
    [shellRef, shell, picked, data]
  );
  /** The packages whose pictures the page shows: the picked ones, and the one the inspector is about. */
  const pictured = useMemo(() => {
    const sel = selected ? data?.mfes.find((m) => m.name === selected) : undefined;
    return sel && !picked.includes(sel) ? [...picked, sel] : picked;
  }, [data, picked, selected]);
  const builds = usePictureBuilds(pictured);
  /** The picture open large; `null` when none is. */
  const [enlarged, setEnlarged] = useState<Shot | null>(null);

  if (err && !data) return <div className={common.error}>{err}</div>;
  if (!data) return <p className={common.muted}>{t('reading_catalogue')}</p>;

  const add = (name: string) => setPicks((p) => (p.includes(name) ? p : [...p, name]));
  const remove = (name: string) => {
    setPicks((p) => p.filter((x) => x !== name));
    if (selected === name) setSelected(null);
  };
  const dirty = !inProduct || JSON.stringify(picks) !== JSON.stringify(saved) || shellRef !== savedShell;
  // Picks the catalogue does not list (a legacy project's, or one removed
  // since) are not on the page; saving must not drop them silently.
  const unknown = picks.filter((n) => !data.mfes.some((m) => m.name === n));
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (unknown.length > 0) throw new Error(t('save_unknown', { names: unknown.join(', ') }));
      const chosen = picks.map((n) => data?.mfes.find((m) => m.name === n)).filter((m): m is Mfe => !!m);
      const { pick, unplaced } = frontendPick(shellRef, chosen, data?.libraries ?? [], data?.gears ?? []);
      if (!pick) throw new Error(t('save_bad_shell', { shell: shellRef }));
      if (unplaced.length > 0) throw new Error(t('save_unplaced', { names: unplaced.join(', ') }));
      await productApi.saveProjectProduct(projectId, { frontend: pick });
      setSaved(picks);
      setSavedShell(shellRef);
      setInProduct(true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const screens = zones.find((z) => z.domain === 'screen')?.items ?? [];
  const shown = screens.find((s) => s.placement.id === page) ?? screens[0];
  const missingCount = [...cover.missing.values()].reduce((n, l) => n + l.length, 0);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const name = e.dataTransfer.getData('text/plain') || dragging;
    if (name) add(name);
    setDragging(null);
  };
  const selectedMfe = selected ? data.mfes.find((m) => m.name === selected) : undefined;
  const q = query.trim().toLowerCase();
  const offers = data.mfes
    .filter((m) => !picks.includes(m.name))
    .filter(
      (m) =>
        !q ||
        [m.name, m.description, ...m.calls, ...m.placements.map(placementLabel)].some((x) => x.toLowerCase().includes(q))
    );

  return (
    <div className={common.stack} data-frontend-constructor>
      <BuildSteps
        steps={steps}
        open={openStep}
        onOpen={setOpenStep}
        shells={data.shells}
        shell={shell}
        shellRef={shellRef}
        onShell={setShellRef}
        t={t}
      />
      {err && <div className={common.error}>{err}</div>}
      <div className={common.row} role="status">
        <span data-frontend-summary>
          {t('summary', { mfes: String(picked.length), screens: String(screens.length) })}
        </span>
        {missingCount > 0 ? (
          <StatusChip tone="warn">{t('gears_missing', { count: String(missingCount) })}</StatusChip>
        ) : picked.length > 0 ? (
          <StatusChip tone="ok">{t('gears_all')}</StatusChip>
        ) : null}
        {cover.unseen.length > 0 && (
          <StatusChip tone="warn" onClick={() => setShowUnseen((v) => !v)} data-unseen-chip="">
            {t('gears_unseen', { count: String(cover.unseen.length) })} {showUnseen ? '▾' : '▸'}
          </StatusChip>
        )}
        <span className={common.grow} />
        <Button type="button" disabled={!dirty || busy || unknown.length > 0} onClick={() => void save()}>
          {busy ? t('saving') : !inProduct ? t('save_to_product') : dirty ? t('save') : t('saved')}
        </Button>
      </div>
      {unknown.length > 0 && (
        <p className={`${common.muted} ${common.small}`} data-frontend-unknown-picks>
          {t('unknown_picks', { names: unknown.join(', ') })}{' '}
          <button type="button" className={common.link} onClick={() => unknown.forEach(remove)}>
            {t('drop_them')}
          </button>
        </p>
      )}
      <p className={`${common.muted} ${common.small}`} data-frontend-gdl-note>
        {inProduct ? t('gdl_note_kept') : t('gdl_note_before')}
      </p>
      {showUnseen && cover.unseen.length > 0 && (
        <div className={styles.box} data-unseen-list>
          {cover.unseen.map((g) => {
            const could = data.mfes.filter((m) => offersFor(g, [m]).length > 0);
            return (
              <div key={g} className={common.small}>
                <code className={common.code}>{g}</code>
                {could.length > 0 ? (
                  <>
                    {' — '}
                    {t('shown_by')}{' '}
                    {could.map((m, i) => (
                      <span key={m.name}>
                        {i > 0 && ', '}
                        <button type="button" className={common.link} onClick={() => add(m.name)}>
                          {m.name}
                        </button>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className={common.muted}> — {t('no_mfe_calls')}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.work}>
        <div className={styles.box} aria-label={t('palette')}>
          <div className={styles.h}>{t('palette')}</div>
          <Input
            type="search"
            placeholder={t('find_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('find_label')}
          />
          {data.mfes.length === 0 && (
            <div className={`${common.stack} ${common.muted} ${common.small}`} data-frontx-suggestion>
              <span>{t('none_to_add')}</span>
              {data.suggestion ? (
                <>
                  <span>
                    {t('read_own')} <code className={common.code}>{data.suggestion}</code>
                  </span>
                  <span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={suggesting !== null}
                      onClick={() => data.suggestion && void addSource(data.suggestion)}
                      data-frontx-add-own=""
                    >
                      {suggesting ?? t('add_and_sync')}
                    </Button>
                  </span>
                </>
              ) : (
                <span>{t('add_repository')}</span>
              )}
            </div>
          )}
          {offers.map((m) => (
            <div
              key={m.name}
              className={styles.offer}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', m.name);
                setDragging(m.name);
              }}
              onDragEnd={() => setDragging(null)}
              data-mfe={m.name}
            >
              <div className={common.row}>
                <span className={styles.glyph} aria-hidden="true">
                  ◧
                </span>
                <b className={styles.name}>{m.name}</b>
                <span className={common.grow} />
                <button type="button" className={common.link} onClick={() => add(m.name)}>
                  {t('add_one')}
                </button>
              </div>
              <p className={`${common.muted} ${common.small}`}>
                {m.placements.length > 0 ? m.placements.map(placementLabel).join(', ') : t('no_screens')}
                {m.calls.length > 0 && <> · {t('calls', { gears: m.calls.join(', ') })}</>}
              </p>
            </div>
          ))}
          <details className={common.small} data-mfe-templates>
            <summary>{t('templates')}</summary>
            <p className={common.muted}>{t('templates_how')}</p>
            {data.templates.length > 0 ? (
              data.templates.map((tpl) => (
                <div key={tpl.name}>
                  <code className={common.code}>{tpl.name}</code>
                  {tpl.kind ? <span className={common.muted}> · {tpl.kind}</span> : null}
                  {tpl.placements.length > 0 ? (
                    <span className={common.muted}> · {tpl.placements.map(placementLabel).join(', ')}</span>
                  ) : null}
                </div>
              ))
            ) : (
              <div>
                {t('templates_in')}{' '}
                <a
                  href={`https://github.com/${frontx.source.repo}/tree/${frontx.source.git_ref}/template-mfe/src-app/mfe_packages`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <code className={common.code}>{frontx.source.repo}</code>
                </a>
                {t('templates_which')}
              </div>
            )}
          </details>
        </div>

        <div
          className={`${styles.box} ${dragging ? styles.over : ''}`}
          aria-label={t('shell')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          data-frontend-shell
        >
          <div className={`${styles.h} ${common.row}`}>
            {t('shell')}
            {shell && (
              <>
                <span>
                  · {shell.name}
                  {shell.version ? `@${shell.version}` : ''}
                </span>
                {shell.signsIn === false && <StatusChip tone="danger">{t('no_sign_in')}</StatusChip>}
                {shell.signsIn === true && <StatusChip tone="ok">{t('signs_in')}</StatusChip>}
                {shell.runtimeEnv === true && <StatusChip tone="ok">{t('reads_env')}</StatusChip>}
                {shell.runtimeEnv === false && <StatusChip>{t('fixed_at_build')}</StatusChip>}
                {(shell.signsIn !== null || shell.runtimeEnv !== null) && <SourceMark described={shell.described} t={t} />}
                <DriftMark drift={shell.drift} t={t} />
              </>
            )}
          </div>
          {shell?.passport && <ShellPassportLine passport={shell.passport} t={t} />}
          <div className={styles.frame}>
            <div className={styles.top}>
              <span className={styles.url}>{shown?.placement.route ?? '/'}</span>
            </div>
            <div className={styles.body}>
              <nav className={styles.nav} aria-label={t('nav_label')}>
                {screens.length === 0 && <div className={styles.empty}>{t('screens_land')}</div>}
                {screens.map(({ mfe, placement }) => (
                  <button
                    key={placement.id}
                    type="button"
                    className={`${styles.navItem} ${shown?.placement.id === placement.id ? styles.on : ''}`}
                    onClick={() => {
                      setPage(placement.id);
                      setSelected(mfe.name);
                    }}
                    title={`${mfe.name}${placement.level ? ` · ${placement.level}` : ''}`}
                  >
                    <Glyph icon={placement.icon} label={placementLabel(placement)} />
                    {placementLabel(placement)}
                  </button>
                ))}
              </nav>
              <main className={styles.page} aria-label={t('page_label')}>
                {shown ? (
                  <PageCard
                    mfe={shown.mfe}
                    placement={shown.placement}
                    missing={cover.missing.get(shown.mfe.name) ?? []}
                    build={builds.get(shown.mfe.name) ?? null}
                    onOpen={() => setSelected(shown.mfe.name)}
                    onEnlarge={setEnlarged}
                    t={t}
                  />
                ) : (
                  <div className={styles.empty}>{t('drag_here')}</div>
                )}
              </main>
              <aside className={styles.side} aria-label={t('sidebar_label')}>
                <ZoneItems zone={zones.find((z) => z.domain === 'sidebar')} onOpen={setSelected} t={t} />
              </aside>
            </div>
            <div className={styles.strips}>
              {zones
                .filter((z) => z.domain !== 'screen' && z.domain !== 'sidebar')
                .map((z) => (
                  <div key={z.domain} className={styles.strip}>
                    <ZoneItems zone={z} onOpen={setSelected} t={t} />
                  </div>
                ))}
            </div>
          </div>
        </div>

        <Inspector
          mfe={selectedMfe}
          shell={shell}
          gears={data.gears}
          missing={selectedMfe ? (cover.missing.get(selectedMfe.name) ?? []) : []}
          picked={selectedMfe ? picks.includes(selectedMfe.name) : false}
          build={selectedMfe ? (builds.get(selectedMfe.name) ?? null) : null}
          onRemove={remove}
          onAdd={add}
          onEnlarge={setEnlarged}
          t={t}
        />
      </div>
      {enlarged && <ShotDialog shot={enlarged.shot} build={enlarged.build} onClose={() => setEnlarged(null)} t={t} />}
    </div>
  );
}

function ZoneItems({
  zone,
  onOpen,
  t,
}: {
  zone: ReturnType<typeof zonesOf>[number] | undefined;
  onOpen: (name: string) => void;
  t: Text;
}) {
  if (!zone) return null;
  return (
    <>
      <div className={styles.zoneH} title={zone.hint}>
        {zone.title}
      </div>
      {zone.items.length === 0 && <div className={styles.empty}>{t('empty')}</div>}
      {zone.items.map(({ mfe, placement }) => (
        <button key={placement.id} type="button" className={styles.chip} onClick={() => onOpen(mfe.name)} title={mfe.name}>
          <Glyph icon={placement.icon} label={placementLabel(placement)} />
          {placementLabel(placement)}
        </button>
      ))}
    </>
  );
}

/** The page the selected screen fills: the picture a build took of it when
 *  the catalogue keeps one for its version, otherwise drawn as lines. The card
 *  selects its package; the picture opens larger. */
function PageCard({
  mfe,
  placement,
  missing,
  build,
  onOpen,
  onEnlarge,
  t,
}: {
  mfe: Mfe;
  placement: Placement;
  missing: string[];
  build: PreviewBuild | null;
  onOpen: () => void;
  onEnlarge: (x: Shot) => void;
  t: Text;
}) {
  const shot = pictureOf(build, placement);
  return (
    <div className={styles.pageCard} onClick={onOpen} data-screen-shot={shot ? 'built' : 'none'}>
      <div className={common.row}>
        <Glyph icon={placement.icon} label={placementLabel(placement)} />
        <b>{placementLabel(placement)}</b>
        {placement.route && <code className={common.code}>{placement.route}</code>}
        {shot && build && (
          <StatusChip tone="neutral" title={t('captured', { at: shot.captured_at })}>
            {t('built_at', { commit: shortCommit(build.commit) })}
          </StatusChip>
        )}
      </div>
      {shot && build ? (
        <button
          type="button"
          className={styles.shot}
          onClick={(e) => {
            e.stopPropagation();
            onEnlarge({ shot, build });
          }}
          title={t('open_larger')}
        >
          <img src={shot.image} alt={placementLabel(placement)} />
        </button>
      ) : (
        <>
          <div className={styles.skeleton} aria-hidden="true">
            <i style={{ width: '60%' }} />
            <i style={{ width: '90%' }} />
            <i style={{ width: '75%' }} />
            <i style={{ width: '40%' }} />
          </div>
          <span className={`${common.muted} ${common.small}`}>{t('no_shot')}</span>
        </>
      )}
      <small>
        {t('from')} <code className={common.code}>{mfe.name}</code>
      </small>
      <span className={common.row}>
        {mfe.calls.length === 0 && <span className={common.muted}>{t('calls_none')}</span>}
        {mfe.calls.map((c) => (
          <StatusChip key={c} tone={missing.includes(c) ? 'danger' : 'ok'}>
            {missing.includes(c) ? '✗' : '✓'} {c}
          </StatusChip>
        ))}
      </span>
    </div>
  );
}

/** A passport that disagrees with its package.json or mfe.json: the passport
 *  still counts, and the tag says which facts drifted. */
function DriftMark({ drift, t }: { drift?: string[]; t: Text }) {
  if (!drift || drift.length === 0) return null;
  return (
    <StatusChip tone="warn" title={drift.join('\n')}>
      {t('drift', { count: String(drift.length) })}
    </StatusChip>
  );
}

/** The shell's passport, compactly: where its screens call the backend, what
 *  it reads at start, how it is built. */
function ShellPassportLine({ passport: p, t }: { passport: ShellPassport; t: Text }) {
  const envKeys = Object.keys(p.env);
  const parts: { k: string; v: string; title?: string }[] = [];
  if (p.apiPrefix) parts.push({ k: t('pp_api'), v: p.apiPrefix, title: t('pp_api_title') });
  if (envKeys.length > 0)
    parts.push({
      k: t('pp_reads'),
      v: envKeys.join(', '),
      title: Object.entries(p.env)
        .map(([k, v]) => `${k} ← ${v}`)
        .join('\n'),
    });
  if (p.buildEnv.length > 0) parts.push({ k: t('pp_needs'), v: p.buildEnv.join(', ') });
  if (p.build) parts.push({ k: t('pp_build'), v: p.output ? `${p.build} → ${p.output}/` : p.build });
  if (p.node) parts.push({ k: 'node', v: p.node });
  if (parts.length === 0) return null;
  return (
    <div className={`${common.row} ${common.muted} ${common.small}`} aria-label={t('pp_label')}>
      {parts.map((x) => (
        <span key={x.k} title={x.title}>
          {x.k} <code className={common.code}>{x.v}</code>
        </span>
      ))}
    </div>
  );
}

/** Where a package's facts came from: its own `frontx.gdl`, or the scan's reading of its files. */
function SourceMark({ described, t }: { described?: boolean; t: Text }) {
  return described ? (
    <StatusChip tone="ok" title={t('declared_title')}>
      {t('declared')}
    </StatusChip>
  ) : (
    <StatusChip title={t('guessed_title')}>{t('guessed')}</StatusChip>
  );
}

function Inspector({
  mfe,
  shell,
  gears,
  missing,
  picked,
  build,
  onRemove,
  onAdd,
  onEnlarge,
  t,
}: {
  mfe: Mfe | undefined;
  shell: Shell | null;
  gears: string[];
  missing: string[];
  picked: boolean;
  build: PreviewBuild | null;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
  onEnlarge: (x: Shot) => void;
  t: Text;
}) {
  if (!mfe) {
    return (
      <div className={styles.box} aria-label={t('inspector')}>
        <p className={`${common.muted} ${common.small}`}>{t('inspector_empty')}</p>
      </div>
    );
  }
  return (
    <div className={styles.box} aria-label={t('inspector')} data-inspector={mfe.name}>
      <h3 className={styles.name}>{mfe.name}</h3>
      {mfe.description && <p>{mfe.description}</p>}
      <section className={styles.section}>
        <div className={styles.h}>{t('where_shows')}</div>
        {mfe.placements.length === 0 && <span className={common.muted}>{t('no_extension')}</span>}
        {mfe.placements.map((p) => {
          const shot = pictureOf(build, p);
          return (
            <div key={p.id} className={styles.place}>
              {shot && build ? (
                <button
                  type="button"
                  className={styles.thumb}
                  onClick={() => onEnlarge({ shot, build })}
                  title={t('open_picture', { name: placementLabel(p) })}
                >
                  <img src={shot.image} alt="" />
                </button>
              ) : (
                <span className={styles.thumb} title={t('no_shot')} />
              )}
              <span>
                <b>{placementLabel(p)}</b> · {p.domain}
                {p.route && (
                  <>
                    {' '}
                    · <code className={common.code}>{p.route}</code>
                  </>
                )}
                {p.level && <span className={common.muted}> · {t('level', { level: p.level })}</span>}
              </span>
            </div>
          );
        })}
      </section>
      <section className={styles.section}>
        <div className={`${styles.h} ${common.row}`}>
          {t('gears_it_calls')} <SourceMark described={mfe.described} t={t} />
        </div>
        {mfe.calls.length === 0 && (
          <span className={common.muted}>{mfe.described ? t('requires_none') : t('names_none')}</span>
        )}
        <div className={common.row}>
          {mfe.calls.map((c) => (
            <StatusChip
              key={c}
              tone={missing.includes(c) ? 'danger' : 'ok'}
              title={mfe.via[c] ? t('through', { via: mfe.via[c] }) : t('own_services')}
            >
              {missing.includes(c) ? t('not_in_product') : '✓'} {c}
              {mfe.via[c] ? ` · via ${mfe.via[c]}` : ''}
            </StatusChip>
          ))}
        </div>
        {missing.length > 0 && <p className={common.small}>{t('add_missing', { gears: missing.join(', ') })}</p>}
        <small className={common.muted}>{t('read_from', { count: String(gears.length) })}</small>
      </section>
      {mfe.roles && (
        <section className={styles.section}>
          <div className={`${styles.h} ${common.row}`}>
            {t('roles')} <SourceMark described t={t} />
          </div>
          {mfe.roles.length === 0 ? (
            <span className={common.muted}>{t('roles_none')}</span>
          ) : (
            <div className={common.row}>
              {mfe.roles.map((r) => (
                <code key={r} className={common.code}>
                  {r}
                </code>
              ))}
            </div>
          )}
        </section>
      )}
      <FitSection mfe={mfe} shell={shell} t={t} />
      {mfe.drift && mfe.drift.length > 0 && (
        <p className={common.small}>
          <DriftMark drift={mfe.drift} t={t} /> {mfe.drift.join('; ')}
        </p>
      )}
      {mfe.version && <small className={common.muted}>{t('version', { version: mfe.version })}</small>}
      {picked ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onRemove(mfe.name)}>
          {t('remove_from_shell')}
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={() => onAdd(mfe.name)}>
          {t('add_to_shell')}
        </Button>
      )}
    </div>
  );
}

/** A constructor step's state as a tone. */
const STEP_TONE: Record<Step['state'], Tone> = { ok: 'ok', warn: 'warn', bad: 'danger', todo: 'neutral', info: 'info' };

/** The steps a build of this frontend takes, in order, each marked with what
 *  the constructor found: folded to how many are ready, unfolded a strip
 *  where one opens to say why. The first step is where the shell is chosen. */
function BuildSteps({
  steps,
  open,
  onOpen,
  shells,
  shell,
  shellRef,
  onShell,
  t,
}: {
  steps: Step[];
  open: Step['id'] | null;
  onOpen: (id: Step['id'] | null) => void;
  shells: Shell[];
  shell: Shell | null;
  shellRef: string;
  onShell: (ref: string) => void;
  t: Text;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const refs = shells
    .map((s) => ({ shell: s, ref: shellRefOf(s) }))
    .filter((x): x is { shell: Shell; ref: string } => !!x.ref);
  const summary = stepsSummary(steps);
  const opened = steps.find((s) => s.id === open) ?? null;
  return (
    <div className={styles.box} aria-label={t('build_label')} data-build-steps data-unfolded={unfolded}>
      <div className={common.row}>
        <span className={styles.h}>{t('build_title')}</span>
        <StatusChip tone={summary.tone} data-build-steps-count="">
          {summary.text}
        </StatusChip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setUnfolded((u) => !u)}
          aria-expanded={unfolded}
          data-build-steps-toggle=""
        >
          {unfolded ? t('hide_steps') : t('show_steps', { count: String(steps.length) })}
        </Button>
      </div>
      {summary.fix.length > 0 && (
        <ul className={styles.fix} data-build-steps-fix>
          {summary.fix.map((s) => (
            <li key={s.id} data-build-step-fix={s.id} data-state={s.state}>
              <button
                type="button"
                className={common.link}
                onClick={() => {
                  setUnfolded(true);
                  onOpen(s.id);
                }}
              >
                {steps.indexOf(s) + 1}. {s.title}
              </button>
              <span className={common.muted}> — {s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {unfolded && (
        <>
          <ol className={styles.strip} aria-label={t('build_label')}>
            {steps.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`${styles.step} ${open === s.id ? styles.on : ''}`}
                  aria-expanded={open === s.id}
                  onClick={() => onOpen(open === s.id ? null : s.id)}
                  data-build-step={s.id}
                  data-state={s.state}
                  title={s.detail}
                >
                  <StatusChip tone={STEP_TONE[s.state]}>{i + 1}</StatusChip> {s.title}
                </button>
              </li>
            ))}
          </ol>
          {opened && (
            <div className={common.stack} data-build-step-open={opened.id}>
              <p className={common.muted}>{opened.detail}</p>
              {opened.id === 'shell' && (
                <label className={common.row}>
                  {t('assemble_on')}
                  <NativeSelect value={shellRef} onChange={(e) => onShell(e.target.value)} aria-label={t('shell')}>
                    {!refs.some((r) => r.ref === shellRef) && (
                      <NativeSelectOption value={shellRef}>{shellRef}</NativeSelectOption>
                    )}
                    {refs.map(({ shell: s, ref }) => (
                      <NativeSelectOption key={ref} value={ref}>
                        {s.name}
                        {s.version ? `@${s.version}` : ''} · {ref.replace(/^github:/, '')}
                        {s.signsIn === true ? ` · ${t('signs_in')}` : s.signsIn === false ? ` · ${t('no_sign_in')}` : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              {opened.id === 'shell' && shell && (
                <div className={common.row}>
                  {Object.entries(shell.carries)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([pkg, v]) => (
                      <code key={pkg} className={common.code}>
                        {pkg.replace('@gears-frontx/', '')} {v}
                      </code>
                    ))}
                </div>
              )}
              {opened.id === 'build' && (
                <ol className={common.small}>
                  <li>
                    <code className={common.code}>npm ci</code>
                  </li>
                  <li>
                    <code className={common.code}>npm run build:packages</code> — {t('cmd_packages')}
                  </li>
                  <li>
                    <code className={common.code}>npm run build:mfes</code> — {t('cmd_mfes')}
                  </li>
                  <li>
                    <code className={common.code}>npm run generate:mfe-manifests</code> — {t('cmd_manifests')}
                  </li>
                  <li>
                    <code className={common.code}>vite build</code> — {t('cmd_site')}
                  </li>
                </ol>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A micro-frontend's FrontX pins against the shell's: what a build gets. */
function FitSection({ mfe, shell, t }: { mfe: Mfe; shell: Shell | null; t: Text }) {
  const pins = Object.keys(mfe.wants ?? {}).length;
  const fit = pins > 0 && shell ? fitOf(mfe, shell) : [];
  return (
    <section className={styles.section} data-fit>
      <div className={styles.h}>{t('fit_title')}</div>
      {pins === 0 ? (
        <span className={common.muted}>{t('fit_unread')}</span>
      ) : !shell ? (
        <span className={common.muted}>{t('fit_no_shell')}</span>
      ) : (
        <table className={styles.fit}>
          <tbody>
            {fit.map((f) => (
              <tr key={f.pkg} data-verdict={f.verdict}>
                <td>
                  <code className={common.code}>{f.pkg.replace('@gears-frontx/', '')}</code>
                </td>
                <td>{f.wants}</td>
                <td>
                  {f.verdict === 'fits' ? `✓ ${f.has}` : f.verdict === 'differs' ? `→ ${f.has}` : t('fit_registry')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {fit.some((f) => f.verdict === 'differs') && <p className={common.small}>{t('fit_differs')}</p>}
    </section>
  );
}
