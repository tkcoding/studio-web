/**
 * Backend: the product's gears, configured (the prototype's "Your product"
 * card, `ProductCard` in kits.tsx, with its `useProjectProduct`). The gears by
 * group with a palette and an inspector (the configurator), or the plain list
 * of picks with their settings when the engine's catalogue cannot be read;
 * what completion adjusted, each undoable; one chip per profile with the
 * engine's verdict and a Check; the fixes that make it resolve; the engine's
 * details; a save refused because the description changed since.
 *
 * Each change is written to the product record straight away; every profile
 * an environment runs is checked again after it. Saving the description as a
 * revision is the strip's Save step above (or the header's Save, which
 * this section takes when asked); Publish writes it to the repository too.
 *
 * Not here: the prototype's IDE kits journey around this card (kits.tsx) —
 * what the specs ask for and the suggested components ("Add the recommended
 * gears"), the code report ("Take the product from the code"), Open in the
 * desktop app and Build in the IDE, kit installs, and the old product
 * branches. A gear's name does not open its catalogue page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import { responseStatus } from '@constructor-studio/mfe-shared';
import {
  productApi,
  type EnvironmentBinding,
  type ProductDescriptionRevision,
  type ProductPreview,
} from '../../../api/client';
import {
  PRODUCT_PROFILES,
  checkLanded,
  checkOf,
  corpusErrors,
  currentDescription,
  diagnosticsByCode,
  environmentsRunning,
  gearLabel,
  profileLabel,
  profilesToCheck,
  verdictOf,
  verdictText,
} from '../../../model/product';
import { PRODUCT_COMMAND_EVENT, announceNext } from '../../../model/product-sections';
import { useConfiguratorTranslations } from '../../../i18n';
import { errText, StatusChip, useScope, type Tone } from '../../common';
import { useGearCatalogue } from '../catalogue';
import { applyFix, fixesFrom, nextStep, productionFixes, type Fix } from './components-flow';
import { GearConfigForm } from './GearConfigForm';
import { useKeptEntities, useRunning } from './hooks';
import { ProductConfigurator } from './ProductConfigurator';
import { useProjectProduct } from './useProjectProduct';
import common from '../../product.module.css';
import styles from './configurator.module.css';

type Text = ReturnType<typeof useConfiguratorTranslations>['t'];

/** How often, and how many times, the record is read again for a save's
 *  check that was still running when the save answered: five minutes. */
const BACKGROUND_CHECK_EVERY_MS = 5_000;
const BACKGROUND_CHECK_READS = 60;

/** The header's actions this section takes (the rest are the kits journey's). */
const TAKES = new Set(['preview', 'fix', 'save']);

/** A save refused because the description changed since this tab read it (ADR-0053 §1). */
interface DescriptionConflict {
  reason: string;
  message: string;
  base_revision?: number | null;
  latest: ProductDescriptionRevision;
  yours: string;
}

/** The conflict in a failed save, when it is one (the prototype's `descriptionConflictOf`). */
export function descriptionConflictOf(e: unknown): DescriptionConflict | null {
  if (responseStatus(e) !== 409) return null;
  const body = (e as { response?: { data?: Partial<DescriptionConflict> } }).response?.data;
  return body?.reason === 'DESCRIPTION_REVISION_STALE' && body.latest ? (body as DescriptionConflict) : null;
}

type Targets = { bindings: EnvironmentBinding[]; environments: { id: string; name: string }[] } | null;

export function ProductBackend() {
  const { projectId } = useScope();
  const { t } = useConfiguratorTranslations();
  const product = useProjectProduct(projectId);
  const { gearbox, picks, record, refresh } = product;

  /** The project's bindings and its environments' names; `undefined` while read. */
  const [targets, setTargets] = useState<Targets | undefined>(undefined);
  useEffect(() => {
    let live = true;
    productApi
      .projectTargets(projectId)
      .then(
        (tg) =>
          live &&
          setTargets({
            bindings: tg.bindings,
            environments: tg.environments.map((e) => ({ id: e.environment.id, name: e.environment.name })),
          })
      )
      .catch(() => live && setTargets(null));
    return () => {
      live = false;
    };
  }, [projectId]);
  const bindings = useMemo(() => targets?.bindings ?? [], [targets]);
  const autoProfiles = profilesToCheck(bindings);

  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  /** The profile a running check is for. */
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The profile whose diagnostics, fixes and map the card shows. */
  const [viewing, setViewing] = useState<string | null>(null);
  const shown = viewing ?? autoProfiles[0];
  // Each profile's last preview here, with the picks and settings it answers.
  const [previews, setPreviews] = useState<Record<string, { preview: ProductPreview; asked: string }>>({});
  const question = JSON.stringify([[...picks].sort(), product.config]);
  const preview = previews[shown]?.preview ?? null;
  const stale = preview !== null && previews[shown]?.asked !== question;
  const current =
    Object.values(previews).find((p) => p.asked === question && p.preview.gdl_sha256)?.preview.gdl_sha256 ??
    currentDescription(record);
  const [conflict, setConflict] = useState<DescriptionConflict | null>(null);
  /** The text of the revision Studio keeps, to tell a changed product from a saved one. */
  const [keptText, setKeptText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    productApi
      .productDescription(projectId)
      .then((d) => live && setKeptText(d.latest?.text ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);

  /** A save's check still running on the server, for its profile and description. */
  const [background, setBackground] = useState<{ profile: string; sha256: string; tries: number } | null>(null);
  const waiting =
    background && !checkLanded(record, background.profile, background.sha256) && background.tries < BACKGROUND_CHECK_READS
      ? background
      : null;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      void refresh().finally(() => setBackground((b) => b && { ...b, tries: b.tries + 1 }));
    }, BACKGROUND_CHECK_EVERY_MS);
    return () => clearTimeout(timer);
  }, [waiting, refresh]);

  /** `write` saves the composed description as the project's next revision
   *  (ADR-0053); `publish` also writes it to the repository. `base` overrides
   *  the revision the save is made against -- "keep mine" after a conflict. */
  const run = async (write: boolean, publish = false, base?: number, profile = shown): Promise<ProductPreview | null> => {
    setBusy(write ? 'save' : 'preview');
    setChecking(profile);
    setError(null);
    try {
      const baseRevision = base ?? record?.description?.revision;
      const result = await productApi.previewProduct(projectId, {
        product_id: product.productId,
        name: product.name,
        gears: picks,
        profile,
        config: product.config,
        ...(write ? { write: true, ...(baseRevision !== undefined ? { base_revision: baseRevision } : {}) } : {}),
        ...(write && publish ? { publish: true } : {}),
      });
      // A save answers before a long check is done: the check lands on the
      // record, which is read again until it does.
      if (result.checking) setBackground({ profile, sha256: result.gdl_sha256 ?? '', tries: 0 });
      else setPreviews((all) => ({ ...all, [profile]: { preview: result, asked: question } }));
      setConflict(null);
      if (write && result.description_revision) setKeptText(result.product_gdl);
      await refresh();
      return result;
    } catch (cause) {
      const refused = descriptionConflictOf(cause);
      if (refused) setConflict(refused);
      else setError(errText(cause));
      return null;
    } finally {
      setBusy(null);
      setChecking(null);
    }
  };
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  /** Check every profile an environment runs, one after another: the engine
   *  takes one product at a time. A newer round makes an older one stop. */
  const rounds = useRef(0);
  const checkBound = useCallback(async () => {
    const mine = ++rounds.current;
    for (const p of profilesToCheck(bindings)) {
      if (rounds.current !== mine) return;
      await runRef.current(false, false, undefined, p);
    }
  }, [bindings]);

  // Completion replaced the picks: show at once what the engine makes of them.
  useEffect(() => {
    if (product.completedAt === 0 || picks.length === 0) return;
    const timer = setTimeout(() => void checkBound(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.completedAt]);

  // Ask the engine on arrival, once the bindings say which profiles to ask
  // for; then again whenever the product changes -- a pick, a setting, a fix.
  const asked0 = useRef(false);
  useEffect(() => {
    if (!product.loaded || targets === undefined || picks.length === 0) return;
    const first = !asked0.current;
    asked0.current = true;
    const timer = setTimeout(() => void checkBound(), first ? 0 : 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.loaded, targets, question]);

  // A product that does not resolve: ask the engine how it would, without
  // applying it, and list each change as its own fix.
  const [fixesRead, setFixesRead] = useState<{ for: ProductPreview; fixes: Fix[] } | null>(null);
  useEffect(() => {
    if (!preview || preview.ok || stale) return;
    let live = true;
    productApi
      .completeProduct(picks, product.config)
      .then(
        (done) =>
          live &&
          setFixesRead({
            for: preview,
            fixes: [...fixesFrom(picks, product.config, done), ...productionFixes(picks, preview.diagnostics)],
          })
      )
      .catch(() => live && setFixesRead({ for: preview, fixes: productionFixes(picks, preview.diagnostics) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, stale]);
  const fixes = preview && !preview.ok && !stale && fixesRead?.for === preview ? fixesRead.fixes : null;
  const [fixesOpen, setFixesOpen] = useState(false);
  /** A gear whose settings a fix asks for, opened on the map. */
  const [focus, setFocus] = useState<{ name: string; at: number } | null>(null);

  const applyOne = (fix: Fix) => {
    if (fix.kind === 'setup') {
      setFocus({ name: fix.gear, at: Date.now() });
      return;
    }
    if (fix.kind === 'config') product.setField(fix.gear, fix.field, fix.value);
    else if (fix.kind === 'remove') product.toggle(fix.gear);
    else product.setPicks((now) => applyFix(now, product.config, fix).picks);
  };

  // What comes next, for the page's header (components-flow.ts `nextStep`).
  // What the specs ask for is the kits journey's, not read here.
  const isSaved = !!(record?.description || record?.written);
  const resolves = preview && !stale ? preview.ok : null;
  const next = nextStep({
    capabilities: 0,
    open: 0,
    picks: picks.length,
    inCode: null,
    resolves,
    fixes: fixes?.length ?? 0,
    written: isSaved && resolves !== null,
    composing: product.composing,
  });
  const nextAction = next.action && TAKES.has(next.action) ? next.action : null;
  useEffect(() => {
    if (product.loaded) announceNext(projectId, nextAction);
  }, [projectId, nextAction, product.loaded]);

  // The header asks: Check it, Show the fixes, Save.
  useEffect(() => {
    const take = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; action: string }>).detail;
      if (d?.projectId !== projectId) return;
      if (d.action === 'preview') void runRef.current(false);
      else if (d.action === 'fix') setFixesOpen(true);
      else if (d.action === 'save') void runRef.current(true);
    };
    window.addEventListener(PRODUCT_COMMAND_EVENT, take);
    return () => window.removeEventListener(PRODUCT_COMMAND_EVENT, take);
  }, [projectId]);

  const catalogue = useGearCatalogue(product.composing, projectId);
  const map = catalogue && 'index' in catalogue ? catalogue.index : null;
  const kept = useKeptEntities(projectId, map);
  const running = useRunning(projectId);
  // Unsaved: the product.gdl on screen is not the revision Studio keeps.
  const changed = !isSaved || (preview !== null && !stale && keptText !== null && preview.product_gdl !== keptText);
  const errors = preview?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = preview?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
  const crateOf = (id: string) => preview?.gears.find((g) => g.id === id)?.crate_name ?? `cf-gears-${id}`;

  if (!product.loaded) return <section className={`${common.card} ${common.muted}`}>{t('reading')}</section>;

  return (
    <section className={common.card} data-product-card>
      {gearbox && !gearbox.enabled && (
        <p className={`${common.muted} ${common.small}`} data-gearbox-off>
          {gearbox.problem ? t('gearbox_off_why', { problem: gearbox.problem }) : t('gearbox_off')}
        </p>
      )}
      <div className={common.row}>
        <b>{t('your_product')}</b>
        <code className={common.code}>{product.productId}</code>
        <span className={`${common.muted} ${common.small} ${styles.pushRight}`} data-engine-line>
          {gearbox?.engine_version ?? 'gearbox'} ·{' '}
          {gearbox?.sources?.length
            ? gearbox.sources.map((s) => `${s.source_id}${s.commit ? `@${s.commit.slice(0, 7)}` : ''}`).join(', ')
            : `${gearbox?.corpus_ref ?? ''}${gearbox?.corpus_commit ? `@${gearbox.corpus_commit.slice(0, 7)}` : ''}`}
        </span>
      </div>

      {map ? (
        <ProductConfigurator
          index={map}
          product={product}
          preview={preview}
          stale={stale}
          busy={busy !== null}
          kept={kept}
          running={running}
          productAt={{ commit: record?.written?.commit_sha, updatedAt: record?.updated_at }}
          focus={focus}
        />
      ) : (
        <>
          <div className={common.row} data-picks>
            {picks.length === 0 ? (
              <span className={`${common.muted} ${common.small}`}>{t('picks_none')}</span>
            ) : (
              picks.map((name) => (
                <Badge key={name} variant="outline">
                  <b>{gearLabel(name)}</b>
                  <button
                    type="button"
                    className={common.link}
                    title={t('take_out')}
                    aria-label={t('remove_gear', { gear: name })}
                    onClick={() => product.toggle(name)}
                  >
                    ×
                  </button>
                </Badge>
              ))
            )}
          </div>
          <GearConfigForm product={product} />
          {catalogue && 'error' in catalogue && (
            <p className={`${common.muted} ${common.small}`}>{t('catalogue_failed', { error: catalogue.error })}</p>
          )}
        </>
      )}

      {product.adjustments.length > 0 && (
        <div className={common.small} data-adjustments>
          <div className={common.muted}>{t('adjusted')}</div>
          <ul className={styles.bullets}>
            {product.adjustments.map((c) => (
              <li key={`${c.gear}-${c.added}-${c.reason}`}>
                <b>{c.added ? '+' : '−'}</b> <b>{gearLabel(c.gear)}</b>
                <span className={common.muted}> — {c.reason}</span>
                {!c.added && !picks.includes(c.gear) && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={common.link}
                      onClick={() => product.setPicks((now) => [...now, c.gear])}
                    >
                      {t('put_back')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {product.saveError && <div className={common.error}>{t('not_saved', { error: product.saveError })}</div>}

      <div className={common.row}>
        <ProfileVerdicts
          t={t}
          targets={targets ?? null}
          current={current}
          record={record}
          shown={shown}
          checking={busy === 'preview' ? checking : null}
          disabled={busy !== null || picks.length === 0}
          onShow={setViewing}
          onCheck={(p) => {
            setViewing(p);
            void run(false, false, undefined, p);
          }}
        />
        <span className={common.small} data-product-verdict>
          {busy === 'preview' && checking === shown ? (
            <StatusChip tone="running">{t('checking')}</StatusChip>
          ) : waiting?.profile === shown ? (
            <StatusChip tone="running">{t('checking_background')}</StatusChip>
          ) : preview && !stale ? (
            <StatusChip tone={preview.ok ? 'ok' : 'danger'}>
              {preview.ok ? t('resolves_for', { profile: profileLabel(preview.profile) }) : t.count('errors', errors)}
            </StatusChip>
          ) : null}
        </span>
        {stale && preview && <StatusChip tone="warn">{t('stale')}</StatusChip>}
        {/* Saving is the page's, step 2 of the strip above: here only
            whether there is anything to save. */}
        {picks.length > 0 && preview && !stale && (
          <span className={`${common.muted} ${common.small}`} data-product-save-hint>
            {changed
              ? record?.description
                ? t('changed_since', { revision: String(record.description.revision) })
                : t('not_saved_yet')
              : record?.description
                ? t('saved_as', { revision: String(record.description.revision) })
                : null}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={styles.pushRight}
          disabled={busy !== null || !preview || stale}
          title={t('publish_title')}
          onClick={() => void run(true, true)}
          data-product-publish
        >
          {busy === 'save' ? t('saving') : t('publish')}
        </Button>
      </div>
      {error && <div className={common.error}>{error}</div>}

      {preview && !preview.ok && !stale && !fixesOpen && (
        <div className={`${common.row} ${common.small}`} data-product-errors-folded>
          <StatusChip tone="danger">
            {t('errors_for', { errors: t.count('errors', errors), profile: profileLabel(preview.profile) })}
          </StatusChip>
          <span className={common.muted}>{t('errors_folded')}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setFixesOpen(true)} data-product-errors-show>
            {fixes && fixes.length > 0 ? t.count('show_fixes', fixes.length) : t('show_errors')}
          </Button>
        </div>
      )}
      {preview && !preview.ok && !stale && fixesOpen && (
        <ul className={`${styles.bullets} ${common.error} ${common.small}`} data-product-errors>
          {preview.diagnostics
            .filter((d) => d.severity === 'error')
            .map((d, i) => (
              <li key={`${d.code}-${i}`}>
                <code className={common.code}>{d.code}</code> {d.message}
              </li>
            ))}
        </ul>
      )}
      {fixesOpen && fixes && fixes.length > 0 && (
        <div className={`${styles.panel} ${styles.fixes}`} data-product-fixes>
          <div className={common.row}>
            <b>{t.count('fixes_title', fixes.length)}</b>
            {fixes.some((f) => f.kind !== 'setup') && (
              <Button
                type="button"
                size="sm"
                className={styles.pushRight}
                disabled={busy !== null}
                // Each as listed: what is applied is what was read.
                onClick={() => fixes.filter((f) => f.kind !== 'setup').forEach(applyOne)}
              >
                {t('apply_all')}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setFixesOpen(false)}>
              {t('hide')}
            </Button>
          </div>
          <ul className={styles.list}>
            {fixes.map((f) => (
              <li key={`${f.kind}-${f.gear}-${f.kind === 'config' ? f.field : ''}`} className={styles.fix} data-fix={f.kind}>
                <span>
                  <FixText fix={f} t={t} />
                  <span className={common.muted}> — {f.reason}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={styles.pushRight}
                  disabled={busy !== null}
                  onClick={() => applyOne(f)}
                >
                  {f.kind === 'setup' ? t('set_up') : t('apply')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fixesOpen && preview && !preview.ok && !stale && fixes && fixes.length === 0 && (
        <p className={`${common.muted} ${common.small}`}>{t('no_fix')}</p>
      )}

      {preview && (
        <details className={stale ? styles.stale : undefined} open={!map} data-engine-details>
          <summary className={`${styles.summary} ${common.small}`}>
            {t('engine_details', {
              errors: t.count('errors', errors),
              warnings: t.count('warnings', warnings),
              applications: t.count('applications', preview.applications.length),
            })}
          </summary>
          <EngineDetails
            preview={preview}
            errors={errors}
            corpus={{ ref: gearbox?.corpus_ref ?? null, engine: gearbox?.engine_version ?? null }}
            picks={picks}
            onPick={(name) => product.setPicks((now) => (now.includes(name) ? now : [...now, name]))}
            crateOf={crateOf}
            t={t}
          />
        </details>
      )}

      {conflict && (
        <div className={`${styles.panel} ${common.error}`} data-description-conflict>
          <p>
            {t('conflict', {
              revision: String(conflict.latest.revision),
              source: conflict.latest.source === 'studio' ? t('conflict_saved') : conflict.latest.source,
              at: conflict.latest.created_at,
            })}
          </p>
          <div className={styles.twoCols}>
            <div>
              <b>{t('conflict_yours')}</b>
              <pre className={common.pre}>{conflict.yours}</pre>
            </div>
            <div>
              <b>{t('conflict_revision', { revision: String(conflict.latest.revision) })}</b>
              <pre className={common.pre}>{conflict.latest.text}</pre>
            </div>
          </div>
          <div className={common.row}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run(true, false, conflict.latest.revision)}
            >
              {t('keep_mine')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => {
                setConflict(null);
                void refresh();
              }}
            >
              {t('take_revision', { revision: String(conflict.latest.revision) })}
            </Button>
          </div>
        </div>
      )}
      {record?.description && (
        <p className={`${common.muted} ${common.small}`} data-description-revision>
          {t('kept_as', { revision: String(record.description.revision) })}{' '}
          {record.published ? (
            <>
              {t('published_on', { revision: String(record.published.revision), branch: record.published.branch })}
              {record.published.pr_url && (
                <>
                  {' '}
                  <a href={record.published.pr_url} target="_blank" rel="noreferrer">
                    {t('its_pull_request')}
                  </a>
                </>
              )}
            </>
          ) : (
            t('not_published')
          )}
        </p>
      )}
    </section>
  );
}

function FixText({ fix, t }: { fix: Fix; t: Text }) {
  switch (fix.kind) {
    case 'add':
      return <>{t('fix_add', { gear: gearLabel(fix.gear) })}</>;
    case 'remove':
      return <>{t('fix_remove', { gear: gearLabel(fix.gear) })}</>;
    case 'replace':
      return <>{t('fix_replace', { gear: gearLabel(fix.gear), with: gearLabel(fix.with) })}</>;
    case 'setup':
      return <>{t('fix_setup', { gear: gearLabel(fix.gear), fields: fix.fields.join(', ') })}</>;
    case 'config':
      return (
        <>
          {t('fix_config', {
            gear: gearLabel(fix.gear),
            field: fix.field,
            value: typeof fix.value === 'string' ? fix.value : JSON.stringify(fix.value),
          })}
        </>
      );
  }
}

/** One chip per profile (ADR-0057): where it runs, what the engine last said
 *  of it, and a Check. The chip picked is the profile the card shows. */
function ProfileVerdicts({
  t,
  targets,
  record,
  current,
  shown,
  checking,
  disabled,
  onShow,
  onCheck,
}: {
  t: Text;
  targets: Targets;
  record: ReturnType<typeof useProjectProduct>['record'];
  /** The hash of the description as it is now, when known. */
  current: string | null;
  shown: string;
  checking: string | null;
  disabled: boolean;
  onShow: (profile: string) => void;
  onCheck: (profile: string) => void;
}) {
  const environments = targets?.environments ?? [];
  const nameOf = (id: string) => environments.find((e) => e.id === id)?.name ?? id.slice(0, 8);
  return (
    <span className={common.row} role="group" aria-label={t('profiles')} data-profile-verdicts>
      {PRODUCT_PROFILES.map((p) => {
        const v = verdictOf(record, p.id, current);
        const envs = environmentsRunning(targets?.bindings ?? [], p.id).map(nameOf);
        const on = p.id === shown;
        const tone: Tone =
          checking === p.id
            ? 'running'
            : v.state === 'ok'
              ? 'ok'
              : v.state === 'failed'
                ? 'danger'
                : v.state === 'stale'
                  ? 'warn'
                  : 'neutral';
        const check = checkOf(record, p.id);
        return (
          <span key={p.id} className={`${styles.profile}${on ? ` ${styles.profileOn}` : ''}`} data-profile-chip={p.id}>
            <button
              type="button"
              className={common.link}
              aria-pressed={on}
              onClick={() => onShow(p.id)}
              title={
                check
                  ? t('profile_title', {
                      errors: String(check.errors),
                      warnings: String(check.warnings),
                      applications: String(check.applications.length),
                    })
                  : t('profile_unchecked')
              }
            >
              <b>{p.label}</b>
            </button>
            <span className={common.muted}>
              {envs.length > 0 ? t('runs_in', { environments: envs.join(', ') }) : t('not_bound')}
            </span>
            <StatusChip tone={tone} data-profile-verdict={v.state}>
              {checking === p.id ? t('checking') : verdictText(v)}
            </StatusChip>
            <button
              type="button"
              className={common.link}
              disabled={disabled}
              onClick={() => onCheck(p.id)}
              data-profile-check={p.id}
            >
              {t('check')}
            </button>
          </span>
        );
      })}
    </span>
  );
}

/** The engine's answer in full: errors in the gears' own descriptions, what
 *  it left out or added, the plugins a host needs, the diagnostics by code,
 *  the applications it runs as, and product.gdl. */
function EngineDetails({
  preview,
  errors,
  corpus,
  picks,
  onPick,
  crateOf,
  t,
}: {
  preview: ProductPreview;
  errors: number;
  corpus: { ref: string | null; engine: string | null };
  picks: string[];
  onPick: (name: string) => void;
  crateOf: (id: string) => string;
  t: Text;
}) {
  const c = corpusErrors(preview.diagnostics);
  return (
    <div className={`${common.stack} ${common.small}`}>
      {c.errors > 0 && (
        <p className={common.error} data-corpus-errors>
          {c.errors === errors ? t('corpus_all') : t('corpus_some', { errors: String(c.errors) })}{' '}
          {t('corpus_files', { files: String(c.files) })}
          {corpus.ref ? ` (${corpus.ref})` : ''}
          {t('corpus_why', { engine: corpus.engine ? ` (${corpus.engine})` : '' })}
        </p>
      )}
      {preview.not_described.length > 0 && (
        <p className={common.muted}>{t('not_described', { gears: preview.not_described.map(gearLabel).join(', ') })}</p>
      )}
      {preview.added.length > 0 && (
        <p className={common.muted}>{t('engine_added', { gears: preview.added.map((a) => `${a.id} (${a.reason})`).join(', ') })}</p>
      )}
      {preview.plugin_options.map((o) => (
        <div key={o.host} className={common.row}>
          <span>{t('needs_plugin', { host: o.host })}</span>
          {o.available.map((name) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={picks.includes(name) ? 'secondary' : 'outline'}
              disabled={picks.includes(name)}
              title={t('plugin_add_title')}
              onClick={() => onPick(name)}
            >
              {picks.includes(name) ? '✓' : '+'} {gearLabel(name)}
            </Button>
          ))}
        </div>
      ))}
      {preview.diagnostics.length > 0 && (
        <ul className={styles.list} data-diagnostic-groups>
          {/* One row per code: errors open, a code said once per gear folded
              to its count and first finding. */}
          {diagnosticsByCode(preview.diagnostics).map((g) => {
            const tone: Tone = g.severity === 'error' ? 'danger' : g.severity === 'warning' ? 'warn' : 'info';
            return (
              <li key={`${g.code}-${g.severity}`} data-diagnostic-group={g.code}>
                <details open={g.severity === 'error'}>
                  <summary className={styles.summary}>
                    <StatusChip tone={tone}>{g.code}</StatusChip>
                    {g.items.length > 1 && <b> × {g.items.length}</b>} {g.items[0].message}
                    {g.items.length > 1 && (
                      <span className={common.muted}> {t('and_more_like_it', { count: String(g.items.length - 1) })}</span>
                    )}
                  </summary>
                  <ul className={styles.bullets}>
                    {g.items.map((d, i) => (
                      <li key={`${d.code}-${i}`}>
                        {d.message}
                        {d.profiles.length > 0 && <span className={common.muted}> · {d.profiles.join(', ')}</span>}
                        {d.file && (
                          <span className={common.muted}>
                            {' '}
                            — {d.file}
                            {d.line ? `:${d.line}` : ''}
                          </span>
                        )}
                        {d.help && <div className={common.muted}>{d.help}</div>}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {preview.applications.map((a) => (
        <div key={a.name} className={styles.application} data-application={a.name}>
          <b>{a.name}</b>
          <span className={common.muted}>
            {' '}
            · {a.kind}
            {a.replicas > 1 ? ` · ×${a.replicas}` : ''}
            {a.listens.length > 0 ? ` · ${a.listens.map((l) => `${l.name} ${l.address}`).join(', ')}` : ''}
          </span>
          <div className={common.row}>
            {a.gears.map((g) => {
              const why = preview.gears.find((x) => x.id === g)?.reasons ?? [];
              const pulled = why.length > 0 && !why.includes('selected');
              return (
                <span key={g} title={`${crateOf(g)}: ${why.join('; ')}`} className={pulled ? common.muted : undefined}>
                  <b>{g}</b>
                  {pulled && <span className={common.small}> ({why[0]})</span>}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <details>
        <summary className={styles.summary}>product.gdl</summary>
        <pre className={common.pre}>{preview.product_gdl}</pre>
      </details>
    </div>
  );
}
