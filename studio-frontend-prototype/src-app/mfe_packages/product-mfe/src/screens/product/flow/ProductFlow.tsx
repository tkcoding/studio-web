/**
 * The Product page's strip (the prototype's `product-flow-view.tsx`):
 * configure the product, save it to product.gdl, build it, deploy it — each
 * step with what the project holds; Save opens below it, Configure opens the
 * map, Build and Deploy open Releases. The model is product-flow.ts.
 *
 * The save is the page's one: it composes the description from what the
 * sections configured (the gears and their configuration, the profile, the
 * frontend), shows what changes against the revision Studio keeps, and saves
 * the next revision. The build and the deploy take that revision; they are
 * Releases' and stay there.
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import {
  productApi,
  type ArtifactNode,
  type Deployment,
  type ProductDescriptionRevision,
  type ProductPreview,
  type ProjectConfig,
  type ProjectProduct,
  type ProjectTargets,
} from '../../../api/client';
import { buildsOf, ideBuildsOf, productBuildsOf, repoPathsOf, type BuildRun, type IdeBuild } from '../../../model/builds';
import { buildsHint, deploysHint } from '../../../model/pipeline';
import { profilesToCheck } from '../../../model/product';
import { lineDiff, productFlow, type DiffLine, type FlowState, type FlowStep } from '../../../model/product-flow';
import { infrastructureOf, type ProductSectionId } from '../../../model/product-sections';
import { deployableBuilds } from '../../../model/project-deploys';
import { useFlowTranslations } from '../../../i18n';
import { errText, openTab, StatusChip, useScope } from '../../common';
import { buildableEnvironments } from './buildable';
import { StepStrip, type StepState, type StripStep } from './StepStrip';
import common from '../../product.module.css';
import styles from './flow.module.css';

type Text = ReturnType<typeof useFlowTranslations>['t'];

/** A flow state as the strip draws it. */
const STEP_STATE: Record<FlowState, StepState> = { done: 'done', todo: 'warn', failed: 'failed', unknown: 'todo', none: 'todo' };

type Read = {
  /** When it was read: the build hint's "how long ago" is measured from it. */
  at: number;
  product: ProjectProduct | null;
  cfg: ProjectConfig | null;
  targets: ProjectTargets | null;
  kept: { revision: number; text: string } | null | undefined;
  builds: IdeBuild[] | null;
  deployments: Deployment[] | null;
};

export function ProductFlow({
  round,
  open,
  onOpen,
  onSection,
  onSaved,
  onSteps,
}: {
  /** Bumped by the page when a section changed the product. */
  round: number;
  /** The step opened below the strip (the page's header opens Save). */
  open: string | null;
  onOpen: (id: string | null) => void;
  onSection: (id: ProductSectionId) => void;
  onSaved: () => void;
  /** The steps as read, for the page's header and its sections' dots. */
  onSteps?: (steps: FlowStep[]) => void;
}) {
  const { projectId, bridge } = useScope();
  const { t } = useFlowTranslations();
  const [read, setRead] = useState<Read | null>(null);
  const [mine, setMine] = useState(0);

  useEffect(() => {
    let live = true;
    const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    Promise.all([
      soft(productApi.projectProduct(projectId), null),
      soft(productApi.projectConfig(projectId), null),
      soft(productApi.projectTargets(projectId), null),
      productApi.productDescription(projectId).then(
        (d) => (d.latest ? { revision: d.latest.revision, text: d.latest.text } : null),
        () => undefined
      ),
      soft(
        productApi.listArtifactNodes('build', projectId, undefined, 50, { sort: 'updated' }).then((p) => p.nodes ?? []),
        null as ArtifactNode[] | null
      ),
      soft(
        productApi
          .listArtifactNodes('workflow_run', projectId, undefined, 50, { sort: 'updated' })
          .then((p) => buildsOf(p.nodes ?? [])),
        [] as BuildRun[]
      ),
      soft(
        productApi.listArtifactNodes('repo', projectId, undefined, 200).then((p) => repoPathsOf(p.nodes ?? [])),
        new Map<string, string>()
      ),
      soft(
        productApi.deployments({ project: projectId }).then((d) => d.items),
        null
      ),
    ]).then(([product, cfg, targets, kept, buildNodes, runs, repoPaths, deployments]) => {
      if (!live) return;
      const builds = buildNodes ? productBuildsOf(ideBuildsOf(buildNodes), runs, cfg?.build, repoPaths) : null;
      setRead({ at: Date.now(), product, cfg, targets, kept, builds, deployments });
    });
    return () => {
      live = false;
    };
  }, [projectId, round, mine]);

  const steps = useMemo(() => {
    if (!read) return null;
    const envs = read.targets?.environments.map((e) => e.environment) ?? [];
    return productFlow({
      product: read.product,
      cfg: read.cfg,
      infra: read.targets || read.product ? infrastructureOf(read.product, read.targets) : null,
      kept: read.kept,
      build: read.builds ? buildsHint(read.builds, buildableEnvironments(envs).length > 0, read.at) : null,
      deploy:
        read.targets && read.deployments
          ? deploysHint({
              environments: read.targets.environments.length,
              bound: read.targets.bindings.length,
              deployable: deployableBuilds(read.builds ?? []).length,
              deployments: read.deployments,
            })
          : null,
    });
  }, [read]);

  useEffect(() => {
    if (steps) onSteps?.(steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tells the page once per reading
  }, [steps]);

  if (!steps || !read) return <p className={common.muted}>{t('reading')}</p>;

  const flow: StripStep[] = steps.map((s) => ({
    id: s.id,
    title: s.title,
    state: STEP_STATE[s.state],
    status: s.status,
    // Configure is the sections below; Build and Deploy are Releases'.
    onSelect: s.id === 'configure' ? () => onSection('map') : s.tab ? () => openTab(bridge, 'releases') : undefined,
    body:
      s.id === 'save' ? (
        <SaveStep
          product={read.product}
          profile={profilesToCheck(read.targets?.bindings ?? [])[0]}
          kept={read.kept}
          t={t}
          onSaved={() => {
            setMine((n) => n + 1);
            onSaved();
          }}
        />
      ) : undefined,
  }));

  return (
    <div data-product-flow>
      <StepStrip steps={flow} label={t('strip_label')} open={open} onOpen={onOpen} />
    </div>
  );
}

/** Compose the description from the product as configured, show what changes
 *  against the kept revision, save the next one. */
function SaveStep({
  product,
  profile,
  kept,
  t,
  onSaved,
}: {
  product: ProjectProduct | null;
  /** The profile the save checks too: the first an environment runs. The
   *  description is the same for any (ADR-0057). */
  profile: string;
  kept: { revision: number; text: string } | null | undefined;
  t: Text;
  onSaved: () => void;
}) {
  const { projectId } = useScope();
  const [draft, setDraft] = useState<ProductPreview | null>(null);
  const [busy, setBusy] = useState<'check' | 'save' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const productId = product?.product_id;
  const gears = product?.gears ?? [];

  async function compose(write: boolean) {
    if (!productId) return;
    setBusy(write ? 'save' : 'check');
    setErr(null);
    try {
      const ask = { product_id: productId, name: product?.name ?? productId, gears, profile, config: product?.config };
      // A save answers within the gateway's limit and is sent again when the
      // gateway loses its answer (the same save is the same revision), so it
      // need not wait out a check first.
      const result = await productApi.previewProduct(projectId, {
        ...ask,
        ...(write ? { write: true, ...(kept ? { base_revision: kept.revision } : {}) } : {}),
      });
      setDraft(write ? null : result);
      if (write) onSaved();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const diff = draft ? lineDiff(kept?.text ?? '', draft.product_gdl) : null;
  const changes = diff?.filter((l) => l.kind !== 'same').length ?? 0;
  return (
    <div className={common.stack}>
      <div className={common.row}>
        <span className={common.grow} />
        {!productId || gears.length === 0 ? (
          <span className={common.muted}>{t('pick_first')}</span>
        ) : (
          <>
            <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => void compose(false)} data-flow-check>
              {busy === 'check' ? t('composing') : t('check')}
            </Button>
            <Button type="button" size="sm" disabled={!!busy} onClick={() => void compose(true)} data-flow-save>
              {busy === 'save'
                ? t('saving')
                : kept
                  ? t('save_revision', { revision: String(kept.revision + 1) })
                  : t('save_first')}
            </Button>
          </>
        )}
      </div>
      {err && <div className={common.error}>{err}</div>}
      {draft && diff && (
        <div className={common.stack} data-flow-diff>
          <div className={`${common.row} ${common.small}`} data-flow-diff-summary>
            {changes === 0 ? (
              <StatusChip tone="ok">{t('nothing_to_save')}</StatusChip>
            ) : (
              <StatusChip tone="info">{t('lines_change', { count: String(changes) })}</StatusChip>
            )}
            {!draft.ok && (
              <StatusChip tone="warn" title={t('not_resolving_title')}>
                {t('not_resolving')}
              </StatusChip>
            )}
            <span className={common.muted}>
              {changes === 0
                ? t('same_as', { revision: String(kept?.revision ?? '') })
                : kept
                  ? t('against_revision', { revision: String(kept.revision) })
                  : t('against_nothing')}
            </span>
          </div>
          <Diff lines={diff} />
        </div>
      )}
      {kept && <Revisions latest={kept} t={t} onRestored={onSaved} />}
    </div>
  );
}

/** A line diff, `-` for what goes and `+` for what comes. */
function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className={styles.diff}>
      {lines.map((l, i) => (
        <div key={i} className={l.kind === 'add' ? styles.add : l.kind === 'del' ? styles.del : undefined}>
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

const SOURCE_KEY: Record<string, string> = {
  studio: 'source_studio',
  repository: 'source_repository',
  migrated: 'source_migrated',
};

/** The description's history (ADR-0053): every save is a revision. One opens
 *  as what changed from it to the latest; restoring it saves its text as the
 *  next revision, so nothing kept is lost. The product as configured is not
 *  changed by a restore: the next save composes from it again. */
function Revisions({
  latest,
  t,
  onRestored,
}: {
  latest: { revision: number; text: string };
  t: Text;
  onRestored: () => void;
}) {
  const { projectId, language } = useScope();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Omit<ProductDescriptionRevision, 'text'>[] | null>(null);
  const [shown, setShown] = useState<ProductDescriptionRevision | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    productApi
      .productDescriptionRevisions(projectId)
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setErr(errText(e)));
    return () => {
      live = false;
    };
  }, [open, projectId, latest.revision]);

  async function show(revision: number) {
    setErr(null);
    try {
      setShown(revision === latest.revision ? null : await productApi.productDescriptionRevision(projectId, revision));
    } catch (e) {
      setErr(errText(e));
    }
  }

  async function restore(r: ProductDescriptionRevision) {
    setBusy(true);
    setErr(null);
    try {
      await productApi.saveProductDescription(projectId, { base_revision: latest.revision, text: r.text });
      setShown(null);
      onRestored();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-flow-history>
      <summary className={styles.summary}>{t('history', { count: String(latest.revision) })}</summary>
      {err && <div className={common.error}>{err}</div>}
      {open && !items && !err && <p className={common.muted}>{t('reading_revisions')}</p>}
      {items && (
        <ul className={styles.revisions}>
          {items.map((r) => (
            <li key={r.revision} className={styles.revision} data-flow-revision={r.revision}>
              <div className={common.grow}>
                <div className={common.row}>
                  <span className={styles.strong}>{t('revision', { revision: String(r.revision) })}</span>
                  {r.revision === latest.revision && <Badge variant="success">{t('current')}</Badge>}
                </div>
                <div className={`${common.muted} ${common.small}`}>
                  {new Date(r.created_at).toLocaleString(language)} ·{' '}
                  {r.author === 'studio' ? 'Studio' : r.author.slice(0, 8)} ·{' '}
                  {SOURCE_KEY[r.source] ? t(SOURCE_KEY[r.source]) : r.source}
                </div>
              </div>
              {r.revision !== latest.revision && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void show(r.revision)}>
                  {shown?.revision === r.revision ? t('shown_below') : t('compare')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {shown && (
        <div className={common.stack} data-flow-revision-diff={shown.revision}>
          <div className={common.row}>
            <span className={`${common.grow} ${common.muted} ${common.small}`}>
              {t('from_to', { from: String(shown.revision), to: String(latest.revision) })}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void restore(shown)}>
              {busy ? t('restoring') : t('restore', { revision: String(latest.revision + 1) })}
            </Button>
          </div>
          <Diff lines={lineDiff(shown.text, latest.text)} />
        </div>
      )}
    </details>
  );
}
