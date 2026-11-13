/**
 * Platform › Repositories: what the platform's catalogue reads (ADR-0042) —
 * the prototype's `PlatformSourcesPanel`, the catalogue settings a platform
 * administrator keeps under Repositories: the repositories (each with its
 * mode, ref and connection) and the crates.io keyword every organization's
 * catalogue reads, saved in the platform's tenant, and a sync of them.
 *
 * Not carried over yet: the list of the platform's gear repositories
 * (ADR-0046, `gear-repository` connections in the root tenant, with their
 * roles, test, delete and add) that the prototype shows above these settings.
 */

import { useEffect, useState } from 'react';
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Input, NativeSelect, NativeSelectOption, Skeleton } from '@gears-frontx/ui-kit';
import { bareSource } from '../../api/ComponentsApiService';
import type { CatalogRepoSource, Connection } from '../../api/types';
import { PLATFORM_ROOT_TENANT_ID, api, errText, useScope, waitForSync } from './common';
import { PageHeader } from './parts';
import styles from './ComponentsScreen.module.css';

const MODES = ['gears', 'frontx', 'kits'];

export function PlatformRepositories() {
  const { platformAdmin, t, container } = useScope();
  return (
    <section className={styles.stack} data-platform-repositories>
      <PageHeader
        title={t('repositories_title')}
        info={<p>{t('repositories_info')}</p>}
        infoLabel={t('about', { title: t('repositories_title') })}
        container={container}
      />
      {platformAdmin ? (
        <PlatformSourcesPanel />
      ) : (
        <Empty data-platform-sources-refused>
          <EmptyHeader>
            <EmptyTitle>{t('platform_sources_admin_only')}</EmptyTitle>
            <EmptyDescription>{t('platform_sources_admin_only_body')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
}

/** The platform's catalogue sources, for a platform administrator. */
function PlatformSourcesPanel() {
  const { org, t } = useScope();
  const orgId = org?.id ?? null;
  const [items, setItems] = useState<CatalogRepoSource[] | null>(null);
  const [keyword, setKeyword] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api()
      .platformSources({ org: orgId })
      .fetch({ staleTime: 0 })
      .then((s) => {
        if (!live) return;
        setItems(s.items ?? []);
        setKeyword(s.crates_io ?? '');
      })
      .catch((e: unknown) => {
        if (live) setStatus(errText(e));
      });
    api()
      .connections({ tenant: PLATFORM_ROOT_TENANT_ID })
      .fetch({ staleTime: 0 })
      .then(({ items: found }) => {
        if (live) setConnections(found.filter((c) => c.provider === 'github'));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [orgId]);

  const patch = (i: number, change: Partial<CatalogRepoSource>) =>
    setItems((cur) => (cur ?? []).map((s, j) => (j === i ? { ...s, ...change } : s)));

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const saved = await api()
        .savePlatformSources(orgId)
        .fetch({ items: (items ?? []).filter((s) => s.repo.trim()).map(bareSource), crates_io: keyword.trim() || null });
      setItems(saved.items);
      setKeyword(saved.crates_io ?? '');
      setStatus(t('platform_saved'));
      return true;
    } catch (e) {
      setStatus(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      const { run_id } = await api().syncPlatform(orgId).fetch(undefined);
      setStatus(t('platform_sync_queued'));
      // The platform's own sync is queued in the caller's home tenant.
      await waitForSync(run_id, null, (l) =>
        setStatus(l.done ? (l.ok ? t('platform_synced', { line: l.text }) : l.text) : `${l.text.split(' · ')[0]}…`)
      );
    } catch (e) {
      setStatus(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.stack} data-platform-sources>
      <p className={styles.hint}>
        <b>{t('platform_sources')}</b> {t('platform_sources_note')}
      </p>
      {items === null ? (
        status ? (
          <p className={styles.error}>{status}</p>
        ) : (
          <Skeleton className={styles.skeleton} />
        )
      ) : (
        <>
          {items.map((s, i) => (
            <div key={i} className={styles.row} data-platform-source={i}>
              <Input
                className={styles.grow}
                aria-label={t('repository_owner_name')}
                placeholder="owner/name"
                value={s.repo}
                onChange={(e) => patch(i, { repo: e.target.value })}
              />
              <NativeSelect aria-label={t('mode')} value={s.mode || 'gears'} onChange={(e) => patch(i, { mode: e.target.value })}>
                {MODES.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {m}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input aria-label={t('ref')} placeholder="HEAD" value={s.git_ref ?? ''} onChange={(e) => patch(i, { git_ref: e.target.value || null })} />
              <NativeSelect
                aria-label={t('connection')}
                value={s.connection_id ?? ''}
                onChange={(e) => patch(i, { connection_id: e.target.value || null })}
              >
                <NativeSelectOption value="">{t('first_github')}</NativeSelectOption>
                {connections.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.label || c.account || c.id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                {t('remove')}
              </Button>
            </div>
          ))}
          <div className={styles.row}>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setItems([...items, { tenant: PLATFORM_ROOT_TENANT_ID, connection_id: null, repo: '', git_ref: null, mode: 'gears' }])
              }
              data-platform-source-add
            >
              {t('add_repository')}
            </Button>
            <label className={styles.formRow}>
              {t('crates_keyword')}
              <Input aria-label={t('crates_keyword')} placeholder={t('none')} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </label>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void save()} data-platform-save>
              {t('save')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void sync()} data-platform-sync>
              {t('save_and_sync')}
            </Button>
          </div>
          {status && <p className={styles.hint}>{status}</p>}
        </>
      )}
    </section>
  );
}
