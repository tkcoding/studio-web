/**
 * What each of the project's sources is for (ADR-0060), the prototype's
 * "Used for" column of Sources (`source-roles-view.tsx`): the two marks as
 * toggles — "Create a gear" puts new gears here, a published product.gdl goes
 * here — one source each, "home" where the description travels, and the commit
 * the latest revision pins. The marks belong to the product, so this kit shows
 * them; Sources keeps the repositories themselves.
 *
 * A mark is written as the prototype wrote it: the config read fresh, the one
 * flag set there and cleared on every other source, written back.
 */

import { useCallback, useEffect, useState } from 'react';
import { productApi } from '../../api/client';
import { named, type ProjectSource } from '../../model/project-sources';
import {
  descriptionHome,
  pinnedCommit,
  shortCommit,
  withFlag,
  type LockedSource,
  type SourceFlag,
} from '../../model/source-roles';
import { useProductTranslations } from '../../i18n';
import { useScope } from '../common';
import styles from '../product.module.css';

const FLAGS: readonly { flag: SourceFlag; text: string; title: string }[] = [
  { flag: 'gears_here', text: 'roles_gears', title: 'roles_gears_title' },
  { flag: 'publish_here', text: 'roles_publish', title: 'roles_publish_title' },
];

export function SourceRoles({ round }: { round?: unknown }) {
  const { projectId } = useScope();
  const { t } = useProductTranslations();
  const [sources, setSources] = useState<ProjectSource[] | null>(null);
  const [lock, setLock] = useState<LockedSource[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void Promise.all([
      productApi.projectConfig(projectId).catch(() => null),
      productApi
        .productDescription(projectId)
        .then((d) => d.latest?.sources_lock ?? [])
        .catch(() => null),
    ]).then(([config, l]) => {
      if (!live) return;
      setSources(config?.sources ?? []);
      setLock(l);
    });
    return () => {
      live = false;
    };
  }, [projectId, round, tick]);

  const toggle = useCallback(
    async (dir: string, flag: SourceFlag, on: boolean) => {
      const key = `${dir}:${flag}`;
      setSaving(key);
      setFailed(null);
      try {
        const config = (await productApi.projectConfig(projectId)) ?? {};
        await productApi.putProjectConfig(projectId, { ...config, sources: withFlag(config.sources, dir, flag, on) });
        setTick((n) => n + 1);
      } catch {
        setFailed(key);
      } finally {
        setSaving(null);
      }
    },
    [projectId]
  );

  const rows = named(sources ?? []);
  if (rows.length === 0) return null;
  const home = descriptionHome(sources ?? []);

  return (
    <div data-source-roles className={`${styles.row} ${styles.small}`}>
      <span className={styles.muted} title={t('roles_hint')}>
        {t('roles_title')}
      </span>
      {rows.map(({ source, dir }) => {
        const pin = lock === null ? undefined : pinnedCommit(lock, source);
        return (
          <span key={dir} data-source-role={dir} className={styles.row}>
            <code className={styles.code} title={source.full_path}>
              {dir}
            </code>
            {FLAGS.map(({ flag, text, title }) => {
              const key = `${dir}:${flag}`;
              return (
                <label key={flag} data-source-flag={flag} title={t(title)} className={styles.muted}>
                  <input
                    type="checkbox"
                    aria-label={`${t(title)}: ${dir}`}
                    checked={!!source[flag]}
                    disabled={saving !== null}
                    onChange={(e) => void toggle(dir, flag, e.currentTarget.checked)}
                  />{' '}
                  {t(text)}
                  {failed === key && (
                    <span className={styles.error} role="status">
                      {' '}
                      {t('roles_not_saved')}
                    </span>
                  )}
                </label>
              );
            })}
            {home === dir && (
              <span className={styles.muted} title={t('roles_home_title')}>
                {t('roles_home')}
              </span>
            )}
            {pin !== undefined && (
              <span className={styles.muted} title={pin ?? undefined}>
                {pin ? t('roles_pinned', { commit: shortCommit(pin) }) : t('not_pinned')}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
