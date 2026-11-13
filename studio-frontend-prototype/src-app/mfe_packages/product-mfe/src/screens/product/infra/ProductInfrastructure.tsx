/**
 * Product › Infrastructure (the prototype's `ProductInfrastructure`,
 * product-sections-view.tsx): what the product needs to run, and where it
 * runs. Per ADR-0056 §3 the environments are Releases'; here each is a chip
 * that opens them. The needs and the infra services that meet them are the
 * editor below (`ProductInfraServices`, ADR-0064).
 */

import { useEffect, useState } from 'react';
import { Button } from '@gears-frontx/ui-kit';
import { productApi, type DeployEnvironment, type ProjectTargets } from '../../../api/client';
import { verdictText } from '../../../model/product';
import { infrastructureOf, type Infrastructure } from '../../../model/product-sections';
import { useInfraTranslations } from '../../../i18n';
import { EmptyState, openTab, StatusChip, useScope, type Tone } from '../../common';
import { ProductInfraServices } from './InfraServices';
import styles from '../../product.module.css';

export function ProductInfrastructure() {
  const { projectId, bridge } = useScope();
  const { t } = useInfraTranslations();
  const [infra, setInfra] = useState<Infrastructure | null>(null);
  const [environments, setEnvironments] = useState<DeployEnvironment[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      productApi.projectProduct(projectId).catch(() => null),
      productApi.projectTargets(projectId).catch((): ProjectTargets | null => null),
    ]).then(([product, targets]) => {
      if (!alive) return;
      setInfra(infrastructureOf(product, targets));
      setEnvironments((targets?.environments ?? []).map((e) => e.environment));
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const releases = () => openTab(bridge, 'releases');
  return (
    <section className={styles.card} data-product-section="infrastructure">
      {!infra ? (
        <p className={styles.muted}>{t('reading_needs')}</p>
      ) : (
        <div className={styles.stack}>
          {/* ADR-0064: the needs, the services deployed with the product and
              their links to the gears, editable. */}
          <ProductInfraServices needs={infra.needs} places={infra.runsIn} environments={environments} />
          {infra.runsIn.length === 0 ? (
            <EmptyState
              title={t('no_environment')}
              action={
                <Button type="button" variant="outline" onClick={releases}>
                  {t('open_releases')}
                </Button>
              }
            />
          ) : (
            <div className={styles.row} data-product-environments>
              <span className={styles.muted}>{t('runs_in')}</span>
              {infra.runsIn.map((r) => {
                const tone: Tone =
                  r.missing.length > 0 || r.verdict?.state === 'failed'
                    ? 'danger'
                    : r.unchecked || !r.profile
                      ? 'warn'
                      : r.verdict?.state === 'ok'
                        ? 'ok'
                        : 'neutral';
                const why =
                  r.missing.length > 0
                    ? t('why_missing', { missing: r.missing.join(', ') })
                    : (r.unchecked ?? (r.verdict ? verdictText(r.verdict) : t('no_profile_bound')));
                return (
                  <StatusChip
                    key={r.environment}
                    tone={tone}
                    onClick={releases}
                    title={t('env_title', { namespace: r.namespace, database: r.database, why })}
                    data-env-chip={r.environment}
                    data-env-verdict={r.verdict?.state ?? 'none'}
                  >
                    {r.environment} · {r.profileLabel ?? t('no_profile')}
                    {r.missing.length > 0 && <span data-env-missing> · {t('no_what', { missing: r.missing.join(', ') })}</span>}
                  </StatusChip>
                );
              })}
              <button type="button" className={styles.link} onClick={releases}>
                {t('environments_in_releases')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
