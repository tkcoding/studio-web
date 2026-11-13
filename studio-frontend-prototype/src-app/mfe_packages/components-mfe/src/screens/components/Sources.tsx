/**
 * Organization › Components › Sources (the prototype's `SourcesPanel` and
 * `runSync`): which repositories, through which connection and at which ref,
 * and the crates.io keyword the next catalogue sync reads; and the sync
 * itself, waited on through its `studio-tasks` run.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import type { Connection } from '../../api/types';
import {
  BRANCH_CHOICES,
  CUSTOM_BRANCH,
  loadSources,
  saveSources,
  syncBody,
  type RepoKey,
  type RepoSel,
  type Sources,
} from '../../model/sources';
import { api, errText, useScope, waitForSync } from './common';
import styles from './ComponentsScreen.module.css';

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export interface CatalogueSync {
  sources: Sources;
  setSrc: (patch: Partial<Sources>) => void;
  setRepo: (which: RepoKey, patch: Partial<RepoSel>) => void;
  run: () => Promise<void>;
  busy: boolean;
  /** The last line of the last sync; empty before one. */
  line: string;
  ok: boolean;
}

export function useCatalogueSync(org: string | null, onSynced: () => void): CatalogueSync {
  const [sources, setSources] = useState<Sources>(() => loadSources(store()));
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  const [ok, setOk] = useState(true);

  const setSrc = useCallback(
    (patch: Partial<Sources>) =>
      setSources((cur) => {
        const next = { ...cur, ...patch };
        saveSources(store(), next);
        return next;
      }),
    []
  );
  const setRepo = useCallback(
    (which: RepoKey, patch: Partial<RepoSel>) =>
      setSources((cur) => {
        const next = { ...cur, [which]: { ...cur[which], ...patch } };
        saveSources(store(), next);
        return next;
      }),
    []
  );

  const run = async () => {
    const body = syncBody(sources, org);
    if (typeof body === 'string') {
      setOk(false);
      setLine(body);
      return;
    }
    setBusy(true);
    setOk(true);
    setLine('queued…');
    try {
      const { run_id } = await api().sync(org).fetch(body);
      // Kept on the server too, so the scheduled sync reads the same sources (ADR-0041).
      void api()
        .saveCatalogSources(org)
        .fetch({ items: body.repositories })
        .catch(() => undefined);
      const last = await waitForSync(run_id, org, (l) => {
        setOk(l.ok);
        setLine(l.done ? l.text : `${l.text.replace(/…$/, '')}…`);
      });
      if (last.ok) onSynced();
    } catch (e) {
      setOk(false);
      setLine(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return { sources, setSrc, setRepo, run, busy, line, ok };
}

/** The organization's GitHub connections, for the source pickers. */
function useGithubConnections(org: string | null): Connection[] {
  const [items, setItems] = useState<Connection[]>([]);
  useEffect(() => {
    if (!org) return;
    let live = true;
    api()
      .connections({ tenant: org })
      .fetch({ staleTime: 0 })
      .then(({ items: found }) => {
        if (live) setItems(found.filter((c) => c.provider === 'github'));
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [org]);
  return items;
}

export function SourcesDialog({ sync, onClose }: { sync: CatalogueSync; onClose: () => void }) {
  const { org, t, container } = useScope();
  const connections = useGithubConnections(org?.id ?? null);
  const { sources, setSrc, setRepo } = sync;
  const editors: { key: RepoKey; title: string; note: string }[] = [
    { key: 'gears', title: t('src_gears_title'), note: t('src_gears_note') },
    { key: 'frontx', title: t('src_frontx_title'), note: t('src_frontx_note') },
    { key: 'kits', title: t('src_kits_title'), note: t('src_kits_note') },
    { key: 'kitsPm', title: t('src_kits_pm_title'), note: t('src_kits_pm_note') },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent container={container} size="lg" closeLabel={t('close')} className={styles.dialog}>
        <section className={styles.stack} data-components-sources-dialog>
          <DialogHeader>
            <DialogTitle>{t('sources_title')}</DialogTitle>
            <DialogDescription>{t('sources_description')}</DialogDescription>
          </DialogHeader>
          <div className={styles.sourceGrid}>
            {editors.map((e) => (
              <RepoSourceEditor
                key={e.key}
                title={e.title}
                note={e.note}
                sel={sources[e.key]}
                onChange={(p) => setRepo(e.key, p)}
                connections={connections}
                noTenant={!org}
              />
            ))}
            <fieldset className={styles.sourceCol}>
              <label className={styles.sourceHead}>
                <Checkbox checked={sources.cratesIo} onCheckedChange={(v) => setSrc({ cratesIo: v === true })} />
                <span>crates.io</span>
              </label>
              <label className={styles.formRow}>
                <span>{t('keyword')}</span>
                <Input
                  placeholder="constructorfabric"
                  value={sources.keyword}
                  disabled={!sources.cratesIo}
                  onChange={(e) => setSrc({ keyword: e.target.value })}
                />
              </label>
              <p className={styles.sub}>{t('src_crates_note')}</p>
            </fieldset>
          </div>
          <div className={styles.row}>
            <Button disabled={sync.busy} onClick={() => void sync.run()} data-components-sync-sources>
              {sync.busy ? t('syncing') : t('sync_catalogue')}
            </Button>
            {sync.line && <span className={sync.ok ? styles.sub : styles.error}>{sync.line}</span>}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function RepoSourceEditor({
  title,
  note,
  sel,
  onChange,
  connections,
  noTenant,
}: {
  title: string;
  note: string;
  sel: RepoSel;
  onChange: (patch: Partial<RepoSel>) => void;
  connections: Connection[];
  noTenant: boolean;
}) {
  const { t } = useScope();
  const custom = !BRANCH_CHOICES.some((b) => b.value === sel.gitRef);
  return (
    <fieldset className={styles.sourceCol} data-source-editor={title}>
      <label className={styles.sourceHead}>
        <Checkbox checked={sel.enabled} onCheckedChange={(v) => onChange({ enabled: v === true })} />
        <span>{title}</span>
      </label>
      <label className={styles.formRow}>
        <span>{t('connection')}</span>
        <NativeSelect value={sel.connectionId} disabled={!sel.enabled} onChange={(e) => onChange({ connectionId: e.target.value })}>
          <NativeSelectOption value="">{connections.length ? t('first_github') : t('no_github')}</NativeSelectOption>
          {connections.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.label || c.account || c.id.slice(0, 8)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className={styles.formRow}>
        <span>{t('repository')}</span>
        <Input placeholder="owner/name" value={sel.repo} disabled={!sel.enabled} onChange={(e) => onChange({ repo: e.target.value })} />
      </label>
      <label className={styles.formRow}>
        <span>{t('branch')}</span>
        <NativeSelect
          value={custom ? CUSTOM_BRANCH : sel.gitRef}
          disabled={!sel.enabled}
          // Choosing "Other…" keeps whatever is typed; the input below edits it.
          onChange={(e) => onChange({ gitRef: e.target.value === CUSTOM_BRANCH ? '' : e.target.value })}
        >
          {BRANCH_CHOICES.map((b) => (
            <NativeSelectOption key={b.value} value={b.value}>
              {b.value === 'HEAD' ? t('branch_head') : b.label}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={CUSTOM_BRANCH}>{t('branch_other')}</NativeSelectOption>
        </NativeSelect>
      </label>
      {custom && (
        <label className={styles.formRow}>
          <span>{t('ref')}</span>
          <Input
            placeholder={t('ref_placeholder')}
            value={sel.gitRef}
            disabled={!sel.enabled}
            onChange={(e) => onChange({ gitRef: e.target.value })}
          />
        </label>
      )}
      <p className={styles.sub}>
        {note}
        {sel.enabled && noTenant ? ` ${t('no_tenant_for_connections')}` : ''}
      </p>
    </fieldset>
  );
}
