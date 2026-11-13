/**
 * Project › Product (the prototype's `product-sections-view.tsx`): one page
 * for the one product. A header names it with a verdict (resolves, or how many
 * errors), where its description is kept, and one action that follows the
 * state (Show the fixes, Save to product.gdl, Build); what the product is; the
 * strip from configured to running; the sources its revision pins; then tabs
 * for its parts, each with a dot for where it stands. Only the chosen part is
 * drawn below them:
 *
 *   Map              the whole product in one picture (the default)
 *   Infrastructure   what the gears need and the infra services that meet it;
 *                    the environments it runs in, as chips that open Releases
 *   Backend          the gears: picked, completed, configured, checked
 *   Frontend         the frontend constructor, or "Add a frontend"
 *   Parts            the project's inventory (the Components tab's screen)
 *
 * Backend here is the configurator itself. The prototype mounted its IDE kits
 * journey (`ProjectKits` from kits.tsx: the code report, suggested components,
 * Open on desktop, Build in the IDE) in that slot; that journey is not ported
 * with this kit.
 */

import { useEffect, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { PRODUCT_CHANGED_EVENT, productApi } from '../../api/client';
import type { FlowState, FlowStep } from '../../model/product-flow';
import {
  PRODUCT_COMMAND_EVENT,
  PRODUCT_NEXT_EVENT,
  PRODUCT_SECTIONS,
  announcedNext,
  openingSection,
  productHeader,
  productSummary,
  type ProductAction,
  type ProductSectionId,
  type ProductSummary,
} from '../../model/product-sections';
import { releaseSources } from '../../model/source-roles';
import { shortCommit } from '../../model/screen-previews';
import { useProductTranslations } from '../../i18n';
import { errText, openTab, PageHeader, Segmented, StatusChip, useScope, type Tone } from '../common';
import { ProjectComponentsInventory } from '../components/ProjectComponentsInventory';
import { ProductBackend } from './configurator/ProductBackend';
import { ProductFlow } from './flow/ProductFlow';
import { ProductKindStep } from './flow/ProductKindStep';
import { ProductFrontend } from './frontend/ProductFrontend';
import { ProductInfrastructure } from './infra/ProductInfrastructure';
import { ProductMap } from './map/ProductMap';
import { SourceRoles } from './SourceRoles';
import styles from '../product.module.css';

/** The section this member last looked at for the project; storage may be
 *  missing or refuse, which is only a convenience lost. */
const sectionKey = (projectId: string) => `studio.product.section.${projectId}`;
function storedSection(projectId: string): string | null {
  try {
    return window.localStorage.getItem(sectionKey(projectId));
  } catch {
    return null;
  }
}
function storeSection(projectId: string, id: ProductSectionId) {
  try {
    window.localStorage.setItem(sectionKey(projectId), id);
  } catch {
    // Not remembered; the page still works.
  }
}

/** A part's state as its tab's dot. */
const DOT: Record<FlowState, Tone> = {
  done: 'ok',
  todo: 'warn',
  failed: 'danger',
  unknown: 'neutral',
  none: 'neutral',
};

const ACTION_KEY: Record<ProductAction, string> = {
  pick: 'action_pick',
  fix: 'action_fix',
  // The IDE kits journey's two (not ported): Backend here never announces them.
  'add-recommended': 'action_add_recommended',
  'take-from-code': 'action_take_from_code',
  preview: 'action_preview',
  save: 'action_save',
  build: 'action_build',
};

export function ProductPage() {
  const { projectId, bridge } = useScope();
  const { t } = useProductTranslations();
  const [section, setSection] = useState<ProductSectionId>(() => {
    // The map is Configure's overview: where the page opens unless this
    // member's last look says otherwise. (The prototype also honoured an old
    // address's `/…/frontend`; the portal's routes have no such suffix.)
    const stored = storedSection(projectId);
    return stored === null || stored === 'map' ? 'map' : openingSection(null, stored);
  });
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  // A product that could not be read is not a product that is not there.
  const [readError, setReadError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [steps, setSteps] = useState<FlowStep[] | null>(null);
  /** The strip's step opened below it: the header's Save opens Save. */
  const [openStep, setOpenStep] = useState<string | null>(null);
  /** What Backend says comes next (ProductBackend announces it). */
  const [next, setNext] = useState<string | null>(() => announcedNext(projectId));

  useEffect(() => {
    let alive = true;
    Promise.all([
      productApi.projectProduct(projectId).then(
        (p) => {
          if (alive) setReadError(null);
          return p;
        },
        (e: unknown) => {
          if (alive) setReadError(errText(e));
          return null;
        }
      ),
      productApi.projectConfig(projectId).catch(() => null),
    ]).then(([product, cfg]) => alive && setSummary(productSummary(product, cfg)));
    return () => {
      alive = false;
    };
  }, [projectId, round]);

  // A section wrote the product -- Backend previewed or saved it, Frontend
  // saved its pick: the header and the strip read the record again.
  useEffect(() => {
    const changed = (e: Event) => {
      if ((e as CustomEvent<string>).detail === projectId) setRound((r) => r + 1);
    };
    window.addEventListener(PRODUCT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(PRODUCT_CHANGED_EVENT, changed);
  }, [projectId]);

  // Backend's next step is the header's action; what it said before this
  // listened is read back by the state's initializer.
  useEffect(() => {
    const said = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; action: string | null }>).detail;
      if (d?.projectId === projectId) setNext(d.action);
    };
    window.addEventListener(PRODUCT_NEXT_EVENT, said);
    return () => window.removeEventListener(PRODUCT_NEXT_EVENT, said);
  }, [projectId]);

  const pick = (id: ProductSectionId) => {
    setSection(id);
    storeSection(projectId, id);
    // The header follows what the sections changed: a save, a frontend added.
    setRound((r) => r + 1);
  };

  /** Ask Backend to take a step: it is shown, then acts. */
  const tellBackend = (action: string) => {
    pick('backend');
    setTimeout(() => window.dispatchEvent(new CustomEvent(PRODUCT_COMMAND_EVENT, { detail: { projectId, action } })), 0);
  };

  const header = summary ? productHeader(summary, next, steps?.find((s) => s.id === 'save')?.state ?? null) : null;
  const act = (a: ProductAction) => {
    if (a === 'pick') pick('backend');
    else if (a === 'save') setOpenStep('save');
    else if (a === 'build') openTab(bridge, 'releases');
    // Backend lists the fixes once it has checked the product as it is.
    else if (a === 'fix' && next === 'preview') tellBackend('preview');
    else tellBackend(a);
  };
  const partsOf = steps?.find((s) => s.id === 'configure')?.parts ?? [];
  const partOf = (id: string) => partsOf.find((p) => p.id === id);
  const gears = summary?.gears ?? 0;
  const tabs: { id: ProductSectionId; label: string }[] = [
    { id: 'map', label: t('tab_map') },
    { id: 'infrastructure', label: t('tab_infrastructure') },
    { id: 'backend', label: gears > 0 ? t('tab_backend_gears', { count: String(gears) }) : t('tab_backend') },
    { id: 'frontend', label: t('tab_frontend') },
    { id: 'parts', label: t('tab_parts') },
  ];

  return (
    <>
      <div data-product-header>
        <PageHeader
          title={summary?.id ?? t('title')}
          info={
            <>
              <p>{t('info_what')}</p>
              <p>{t('info_verdict')}</p>
            </>
          }
          status={
            readError ? (
              <span className={styles.error} data-product-summary>
                {t('read_failed', { error: readError })}
              </span>
            ) : !summary || !header ? (
              <span className={styles.muted}>{t('reading')}</span>
            ) : (
              <span data-product-summary className={styles.row}>
                {header.verdict ? (
                  <StatusChip
                    tone={header.verdict.tone}
                    data-product-verdict={header.verdict.tone}
                    title={summary.preview ? t('warnings', { count: String(summary.preview.warnings) }) : undefined}
                    onClick={header.verdict.tone === 'danger' ? () => act('fix') : undefined}
                  >
                    {header.verdict.text}
                  </StatusChip>
                ) : (
                  <span className={styles.muted}>{t('no_product')}</span>
                )}
                {header.kept && (
                  <StatusChip tone="neutral" data-product-kept="">
                    {header.kept}
                  </StatusChip>
                )}
                {summary.saved?.prUrl && (
                  <a href={summary.saved.prUrl} target="_blank" rel="noreferrer">
                    {t('pull_request')}
                  </a>
                )}
              </span>
            )
          }
          actions={
            header && (
              <Button type="button" onClick={() => act(header.action)} data-product-action={header.action}>
                {t(ACTION_KEY[header.action])}
                {header.action === 'build' ? ' →' : ''}
              </Button>
            )
          }
        />
      </div>
      {/* What the product is comes first: Studio proposes it from the specs
          and a member confirms it (product-kind.ts). */}
      <ProductKindStep />
      <ProductFlow
        round={round}
        open={openStep}
        onOpen={setOpenStep}
        onSection={pick}
        onSaved={() => setRound((r) => r + 1)}
        onSteps={setSteps}
      />
      <ProductSources key={round} />
      <SourceRoles round={round} />
      <div data-product-tabs>
        <Segmented
          label={t('tabs_label')}
          value={section}
          onChange={pick}
          dataAttr="data-product-section-tab"
          items={tabs.map((tab) => {
            const part = partOf(tab.id);
            return {
              id: tab.id,
              label: tab.label,
              title: part?.status ?? PRODUCT_SECTIONS.find((s) => s.id === tab.id)?.hint,
              state: part?.state,
              dot: part ? DOT[part.state] : undefined,
            };
          })}
        />
      </div>
      {section === 'map' && <ProductMap onSection={pick} />}
      {section === 'parts' && <ProjectComponentsInventory onOpenProduct={() => pick('backend')} />}
      {section === 'infrastructure' && <ProductInfrastructure />}
      {/* Kept mounted, as the prototype kept its Backend: its panes keep their state. */}
      <div hidden={section !== 'backend'} data-product-section="backend">
        <ProductBackend />
      </div>
      {section === 'frontend' && <ProductFrontend onChanged={() => setRound((r) => r + 1)} />}
    </>
  );
}

/** The sources the newest description revision pins, one line each (the
 *  prototype's compact `ProductSources`, source-roles-view.tsx). */
function ProductSources() {
  const { projectId } = useScope();
  const { t } = useProductTranslations();
  const [read, setRead] = useState<{ lines: ReturnType<typeof releaseSources>; revision: number } | null>(null);
  useEffect(() => {
    let live = true;
    productApi
      .productDescription(projectId)
      .then((d) => {
        if (!live || d.latest?.revision == null) return;
        setRead({ lines: releaseSources(d.latest.sources_lock ?? []), revision: d.latest.revision });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);
  if (!read) return null;
  return (
    <div data-product-sources className={`${styles.row} ${styles.small} ${styles.muted}`}>
      <span>{t('sources')}</span>
      {read.lines.length === 0 ? (
        <span>{t('sources_none', { revision: String(read.revision) })}</span>
      ) : (
        read.lines.map((l) => (
          <span key={l.repository} data-product-source={l.id} title={l.pinned ?? undefined}>
            <code className={styles.code}>{l.repository.split('/').pop()}</code>{' '}
            {l.pinned ? shortCommit(l.pinned) : t('not_pinned')}
          </span>
        ))
      )}
    </div>
  );
}
