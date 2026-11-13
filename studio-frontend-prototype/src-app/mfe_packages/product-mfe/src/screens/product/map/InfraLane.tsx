/**
 * The Infrastructure tab of the product map's palette (the prototype's
 * `InfraLane`, infra-services-view.tsx, ADR-0064): each need of the gears bound
 * to a deployable infra service from the catalogue, its image or chart source,
 * and its import into the project's path.
 *
 * The services are kept in product.gdl through `infra-store.ts`, which edits
 * the description's text in the browser as the prototype did (a server route
 * is to take that over).
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import { productApi } from '../../../api/client';
import type { DeployEnvironment, InfraPassport, InfraService, ProductTechnology } from '../../../api/types';
import { bindNeeds, deployable, importedFrom, offeredInfra, serviceFrom, sourceText, variableOf } from '../../../model/infra-services';
import { infraStore } from '../../../model/infra-store';
import { useMapTranslations } from '../../../i18n';
import { errText, useScope } from '../../common';
import styles from './ProductMap.module.css';

/** The bearer argument the moved-unchanged store still takes; `authShared()` carries the real one. */
const NO_TOKEN = '';

export function InfraLane({ needs, environments }: { needs: ProductTechnology[] | null; environments: DeployEnvironment[] }) {
  const { projectId } = useScope();
  const { t } = useMapTranslations();
  const [services, setServices] = useState<InfraService[] | null>(null);
  const [offered, setOffered] = useState<InfraPassport[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const env = environments.find((e) => e.kind !== 'research') ?? null;

  useEffect(() => {
    let live = true;
    Promise.all([
      infraStore(NO_TOKEN, projectId)
        .load()
        .catch(() => ({ items: [] as InfraService[] })),
      productApi.listComponents(projectId).catch(() => ({ nodes: [] })),
    ]).then(([s, c]) => {
      if (!live) return;
      setServices(s.items);
      setOffered(offeredInfra(c.nodes ?? []));
    });
    return () => {
      live = false;
    };
  }, [projectId, round]);

  const save = useCallback(
    async (next: InfraService[], what: string) => {
      setBusy(what);
      setError(null);
      try {
        const saved = await infraStore(NO_TOKEN, projectId).save(next, null);
        setServices(saved.items);
        setNote(what);
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(null);
      }
    },
    [projectId]
  );

  const importImage = async (s: InfraService) => {
    if (!env || !s.passport.image) return;
    setBusy(`import ${s.passport.name}`);
    setError(null);
    try {
      await productApi.importImage(projectId, { environment_id: env.id, source: s.passport.image, name: s.passport.name });
      setNote(t('infra_importing', { image: s.passport.image, env: env.name }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const takeImported = async (s: InfraService) => {
    setBusy(`use ${s.passport.name}`);
    setError(null);
    try {
      const records = await productApi.projectImages(projectId, { app: s.passport.name, kind: 'image' });
      const found = importedFrom(records.items, s.passport.image)[0];
      if (!found) {
        setError(t('infra_no_copy', { image: s.passport.image ?? '' }));
        return;
      }
      await save(
        (services ?? []).map((x) => (x.passport.name === s.passport.name ? { ...x, image: found.reference } : x)),
        t('infra_runs', { name: s.passport.name, image: found.reference })
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  if (services === null) return <p className={styles.muted}>{t('infra_reading')}</p>;
  const bound = bindNeeds(needs ?? [], services, offered);
  const unneeded = services.filter((s) => !bound.some((b) => b.service === s));
  const card = (s: InfraService) => (
    <div key={s.passport.name} className={styles.item} data-infra-service={s.passport.name}>
      <div className={styles.grow}>
        <div className={styles.itemName}>
          {s.passport.name}
          {s.passport.version ? ` ${s.passport.version}` : ''}{' '}
          <Badge variant={deployable(s) ? 'success' : 'warning'} data-infra-deployable={String(deployable(s))}>
            {deployable(s) ? t('infra_deployable') : t('infra_not_imported')}
          </Badge>
        </div>
        <div className={styles.itemSub}>{sourceText(s)}</div>
        {Object.keys(s.passport.provides).length > 0 && (
          <div className={styles.itemSub}>
            {t('infra_gives', {
              what: Object.keys(s.passport.provides)
                .map((k) => `${k} as \${${variableOf(k)}}`)
                .join(', '),
            })}
          </div>
        )}
        <div className={styles.row}>
          {!s.image && s.passport.image && (
            <Button size="sm" variant="ghost" disabled={!!busy || !env} onClick={() => void importImage(s)}>
              {t('infra_import')}
            </Button>
          )}
          {!s.image && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void takeImported(s)}>
              {t('infra_use_imported')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() =>
              void save(
                services.filter((x) => x.passport.name !== s.passport.name),
                t('infra_removed', { name: s.passport.name })
              )
            }
          >
            {t('remove')}
          </Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className={styles.stack} data-infra-lane>
      <p className={`${styles.muted} ${styles.hint}`}>{t('infra_hint')}</p>
      {needs === null && <p className={styles.muted}>{t('infra_needs_later')}</p>}
      {bound.map((b) => (
        <div key={b.need.id} data-infra-need={b.need.id}>
          <div className={styles.itemSub}>
            <b>{b.need.name}</b> — {b.need.why};{' '}
            {t('infra_for_gears', { count: String(b.need.gears.length) })}
            {b.capability ? ` · ${t('infra_needs_capability', { capability: b.capability })}` : ''}
          </div>
          {b.service ? (
            card(b.service)
          ) : b.offer ? (
            <div className={styles.item}>
              <div className={styles.grow}>
                <div className={styles.itemName}>{t('infra_offer', { name: b.offer.name })}</div>
                <div className={styles.itemSub}>{b.offer.description ?? b.offer.image}</div>
              </div>
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => void save([...services, serviceFrom(b.offer!)], t('infra_added', { name: b.offer!.name }))}
              >
                {t('add')}
              </Button>
            </div>
          ) : (
            <p className={styles.muted}>{t('infra_no_offer')}</p>
          )}
        </div>
      ))}
      {unneeded.map(card)}
      {note && <p className={styles.muted}>{note}</p>}
      {error && <p className={styles.error}>{error}</p>}
      <span>
        <Button size="sm" variant="ghost" onClick={() => setRound((r) => r + 1)}>
          {t('read_again')}
        </Button>
      </span>
    </div>
  );
}
