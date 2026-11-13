import { useEffect, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import { AdminApiService } from '../../../api/AdminApiService';
import type { DomainConformance as Report } from '../../../api/types';
import { ErrorLine, errText, useAdmin } from '../common';
import styles from '../Admin.module.css';

/** Read-only evidence about stored data, not a mutation or a data migration. */
export function DomainConformance({ orgId, typeId }: { orgId: string; typeId: string }) {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);

  const check = async () => {
    const token = ++request.current;
    setBusy(true); setError(null);
    try {
      const result = await api.domainConformance({ orgId, typeId }).fetch({ staleTime: 0 });
      if (token === request.current) setReport(result);
    } catch (e) {
      if (token === request.current) { setReport(null); setError(errText(e)); }
    } finally {
      if (token === request.current) setBusy(false);
    }
  };
  const kind = (value: string | null | undefined) =>
    value && ['missing', 'type', 'enum'].includes(value) ? t(`dm_conformance_${value}`) : value ?? '';

  return <section aria-label={t('dm_conformance')}>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>
      {busy ? t('reading') : t('dm_conformance')}
    </Button>
    {error && <ErrorLine>{error}</ErrorLine>}
    {report && <>
      <p>{t('dm_conformance_summary', { checked: String(report.checked), conforming: String(report.conforming) })}</p>
      {report.truncated && <p role="status" className={styles.muted}>{t('dm_conformance_partial')}</p>}
      {report.checked === 0 && <p className={styles.muted}>{t('dm_conformance_empty')}</p>}
      {report.violations.length > 0 && <Table aria-label={t('dm_conformance_violations')}>
        <TableHeader><TableRow><TableHead>{t('dm_col_field')}</TableHead><TableHead>{t('dm_conformance_reason')}</TableHead><TableHead>{t('dm_objects_label')}</TableHead></TableRow></TableHeader>
        <TableBody>{report.violations.map((v) => <TableRow key={`${v.field}:${v.kind}`}>
          <TableCell><code>{v.field}</code></TableCell><TableCell>{kind(v.kind)}</TableCell><TableCell>{v.count}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {report.undeclared.length > 0 && <>
        <p className={styles.muted}>{t('dm_conformance_undeclared')}</p>
        <ul>{report.undeclared.map((v) => <li key={v.field}><code>{v.field}</code> · {v.count}</li>)}</ul>
      </>}
      {report.sample.length > 0 && <details><summary>{t('dm_conformance_samples')}</summary>
        <ul>{report.sample.map((s) => <li key={s.instance_id}><code>{s.instance_id}</code> · {s.violations.join('; ')}</li>)}</ul>
      </details>}
    </>}
  </section>;
}
