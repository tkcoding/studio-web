/**
 * What a candidate gear would bring into the product with it, asked before it
 * is added (the prototype's gear-brings-view.tsx). The parent keys it by the
 * question — the candidate, the picks and the configuration — so another
 * question is another read, from nothing.
 */

import { useEffect, useState } from 'react';
import { productApi, type GearConfig } from '../../../api/client';
import { bringsSummary, contractLabel, type GearBrings } from '../../../model/gear-brings';
import { useConfiguratorTranslations } from '../../../i18n';
import { errText } from '../../common';
import common from '../../product.module.css';
import styles from './configurator.module.css';

export function BringsWithIt({
  picks,
  config,
  candidate,
  onClose,
}: {
  picks: string[];
  config: GearConfig;
  candidate: string;
  onClose: () => void;
}) {
  const { t } = useConfiguratorTranslations();
  const [read, setRead] = useState<GearBrings | { error: string } | null>(null);

  useEffect(() => {
    let live = true;
    productApi
      .gearBrings(picks, candidate, config)
      .then((b) => live && setRead(b))
      .catch((e: unknown) => live && setRead({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [picks, candidate, config]);

  return (
    <div className={styles.panel} role="region" aria-label={t('brings_title', { gear: candidate })}>
      <div className={common.row}>
        <b>{t('brings_title', { gear: candidate })}</b>
        <button type="button" className={`${common.link} ${styles.pushRight}`} onClick={onClose}>
          {t('close')}
        </button>
      </div>
      {read === null && <div className={common.muted}>{t('brings_reading')}</div>}
      {read && 'error' in read && <div className={common.error}>{read.error}</div>}
      {read && 'brought' in read && (
        <>
          <div>{bringsSummary(candidate, read)}</div>
          {read.overlaps.length > 0 && (
            <ul className={`${styles.bullets} ${styles.missing}`}>
              {read.overlaps.map((o) => (
                <li key={o.contract}>
                  {o.already.length > 0
                    ? t('brings_overlap_already', {
                        contract: contractLabel(o.contract),
                        brought: o.brought.join(', '),
                        already: o.already.join(', '),
                      })
                    : t('brings_overlap_twice', { contract: contractLabel(o.contract), brought: o.brought.join(', ') })}
                </li>
              ))}
            </ul>
          )}
          {read.brought.length > 0 && (
            <ul className={styles.bullets}>
              {read.brought.map((g) => (
                <li key={g.gear}>
                  <code className={common.code}>{g.gear}</code> <span className={common.muted}>— {g.reason}</span>
                  {g.database && <span className={common.muted}> · {t('brings_own_database')}</span>}
                </li>
              ))}
            </ul>
          )}
          {read.changes.length > 0 && (
            <ul className={`${styles.bullets} ${common.muted}`}>
              {read.changes.map((c, i) => (
                <li key={i}>
                  {c.added ? '+' : '−'} {c.gear}: {c.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
