import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Card, CardContent, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import { AdminApiService } from '../../../api/AdminApiService';
import type { DomainModelHistory } from '../../../api/types';
import { ErrorLine, errText, useAdmin, useConfirm } from '../common';
import styles from '../Admin.module.css';

const Graph = lazy(() => import('./DomainModelGraph').then((m) => ({ default: m.DomainModelGraph })));

/** POC model-wide tools, scoped to the organization being administered. */
export function DomainModelTools({ orgId, canEdit, onChanged }: { orgId: string; canEdit: boolean; onChanged: () => void }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [view, setView] = useState<'graph' | 'history' | 'transfer' | null>(null);
  const [history, setHistory] = useState<DomainModelHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [ask, confirmation] = useConfirm();
  const changed = () => { setRevision((n) => n + 1); onChanged(); };

  useEffect(() => {
    if (view !== 'history') return;
    let live = true;
    api.domainHistory({ orgId }).fetch({ staleTime: 0 }).then(
      (h) => { if (live) { setHistory(h); setError(null); } },
      (e: unknown) => { if (live) setError(errText(e)); }
    );
    return () => { live = false; };
  }, [api, orgId, view, revision]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const exportModel = () => run(async () => {
    const result = await api.domainTypes({ orgId }).fetch({ staleTime: 0 });
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.ontology, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `studio-model-${orgId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  const importModel = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    void run(async () => {
      const ontology: unknown = JSON.parse(await file.text());
      if (typeof ontology !== 'object' || ontology === null || !('entities' in ontology) || !Array.isArray(ontology.entities)) {
        throw new Error(t('dm_import_invalid'));
      }
      ask({ title: t('dm_import'), body: t('dm_import_confirm', { file: file.name, count: String(ontology.entities.length) }), confirmLabel: t('dm_import') },
        async () => { await api.importDomainModel(orgId).fetch({ ontology }); changed(); });
    });
  };

  return <>
    <div className={styles.inline} role="group" aria-label={t('dm_tools')}>
      {(['graph', 'history', 'transfer'] as const).map((key) => <Button key={key} size="sm" variant={view === key ? 'secondary' : 'outline'} aria-pressed={view === key}
        onClick={() => { setError(null); setView(view === key ? null : key); }}>{t(`dm_tools_${key}`)}</Button>)}
    </div>
    {view && <Card><CardContent className={styles.cardBody}>
      {error && <ErrorLine>{error}</ErrorLine>}
      {view === 'graph' && <>
        {canEdit && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
          await api.syncDomainModel(orgId).fetch(undefined); changed();
        })}>{t('dm_sync_graph')}</Button>}
        <Suspense fallback={<p>{t('reading')}</p>}><Graph key={`${orgId}:${revision}`} orgId={orgId} /></Suspense>
      </>}
      {view === 'transfer' && <>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportModel()}>{t('dm_export')}</Button>
        {canEdit && <label className={styles.field}>{t('dm_import')}<Input type="file" accept=".json,application/json" disabled={busy} onChange={importModel} /></label>}
        <p className={styles.muted}>{t('dm_import_hint')}</p>
      </>}
      {view === 'history' && (history ? <>
        <p className={styles.muted}>{t('dm_history_head', { version: String(history.head) })}</p>
        <Table><TableHeader><TableRow><TableHead>{t('dm_version')}</TableHead><TableHead>{t('dm_change')}</TableHead><TableHead>{t('dm_author')}</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{history.revisions.map((r) => {
            const blocked = history.revisions.some((next) => next.version > r.version && next.undo.length === 0);
            return <TableRow key={r.version}><TableCell>{r.version}<br /><span className={styles.sub}>{new Date(r.at).toLocaleString(language)}</span></TableCell>
              <TableCell>{r.summary}<details><summary>{t('dm_change_details')}</summary><pre style={{ whiteSpace: 'pre-wrap', maxWidth: '45rem' }}>{JSON.stringify({ operation: r.op, target: r.target, patch: r.patch, undo: r.undo }, null, 2)}</pre></details></TableCell>
              <TableCell><code>{r.by}</code></TableCell><TableCell>{canEdit && r.version < history.head && <Button size="sm" variant="outline" disabled={blocked}
                title={blocked ? t('dm_revert_blocked') : undefined} onClick={() => ask({ title: t('dm_revert'), body: t('dm_revert_confirm', { version: String(r.version) }), confirmLabel: t('dm_revert') },
                  async () => { await api.revertDomainModel(orgId).fetch({ to: r.version }); changed(); })}>{t('dm_revert')}</Button>}</TableCell></TableRow>;
          })}</TableBody></Table>
      </> : !error && <p>{t('reading')}</p>)}
    </CardContent></Card>}
    {confirmation}
  </>;
}
