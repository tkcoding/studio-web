/**
 * The Product page's Frontend section (the prototype's `ProductFrontend`,
 * product-sections-view.tsx): the frontend constructor when the product has a
 * frontend, an offer to add one when it does not. Removing it drops the
 * product's pick and a project's older record of one in its configuration.
 */

import { useEffect, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { productApi, type FrontendPick, type ProjectConfig, type ProjectProduct } from '../../../api/client';
import { hasFrontend, newFrontend, withoutFrontend } from '../../../model/product-sections';
import { useFrontendTranslations } from '../../../i18n';
import { errText, useScope } from '../../common';
import { FrontendConstructor } from './FrontendConstructor';
import { useFrontxDefaults } from './frontxDefaults';
import common from '../../product.module.css';

export function ProductFrontend({ onChanged }: { onChanged: () => void }) {
  const { projectId } = useScope();
  const { t } = useFrontendTranslations();
  const [cfg, setCfg] = useState<ProjectConfig | null | undefined>(undefined);
  const [product, setProduct] = useState<ProjectProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The deployment's shell template (STUDIO_FRONTX_SHELL_TEMPLATE).
  const starter = newFrontend(useFrontxDefaults().shellTemplate);

  useEffect(() => {
    let alive = true;
    Promise.all([productApi.projectConfig(projectId), productApi.projectProduct(projectId).catch(() => null)])
      .then(([c, p]) => {
        if (!alive) return;
        setProduct(p);
        setCfg(c);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setCfg(null);
        setErr(errText(e));
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  /** Give the product a frontend, or take it away (`null`): the product keeps
   *  it, and a project's older record of one in its configuration goes too. */
  async function change(frontend: FrontendPick | null) {
    setBusy(true);
    setErr(null);
    try {
      const saved = await productApi.saveProjectProduct(projectId, { frontend });
      setProduct(saved.value);
      if (!frontend) {
        const fresh = await productApi.projectConfig(projectId);
        if (fresh?.frontend) {
          const value = withoutFrontend(fresh);
          await productApi.putProjectConfig(projectId, value);
          setCfg(value);
        }
      }
      onChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const has = hasFrontend(cfg, product);
  const picked = product?.frontend?.mfes.length ?? cfg?.frontend?.mfes?.length ?? 0;
  return (
    <section className={common.card} data-product-section="frontend" data-product-frontend={has ? 'yes' : 'no'}>
      {has && (
        <div className={common.row}>
          <span className={common.grow} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            title={picked > 0 ? t('remove_title', { count: String(picked) }) : undefined}
            onClick={() => {
              if (picked === 0 || window.confirm(t('remove_confirm'))) void change(null);
            }}
          >
            {t('remove')}
          </Button>
        </div>
      )}
      {err && <div className={common.error}>{err}</div>}
      {cfg === undefined ? (
        <p className={common.muted}>{t('reading_has')}</p>
      ) : has ? (
        <FrontendConstructor />
      ) : (
        <div className={common.stack} data-add-frontend>
          <p>
            {t('none_lead')} <code className={common.code}>{starter.shell.path}</code> {t('none_in')}{' '}
            <a href={`https://github.com/${starter.shell.repo}`} target="_blank" rel="noreferrer">
              {starter.shell.repo}
            </a>
            {t('none_tail')}
          </p>
          <span>
            <Button type="button" disabled={busy} onClick={() => void change(starter)}>
              {busy ? t('adding') : t('add')}
            </Button>
          </span>
        </div>
      )}
    </section>
  );
}
