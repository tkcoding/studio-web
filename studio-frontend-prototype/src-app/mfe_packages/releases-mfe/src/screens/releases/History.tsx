/**
 * Releases' History step: the project's deploys, newest first, one row each
 * -- what, where, who and when (the prototype's DeployHistory in
 * environments-screen.tsx at 00828880). A row opens on what the deploy said
 * -- its reason, its outcome with a crashed container's error -- and asks
 * the cluster how the release is now.
 */

import { Fragment, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import type { Deployment, DeploymentStatus } from '../../api/types';
import { canReadStatus, shortCommit } from '../../model/environments';
import { versionOf } from '../../model/releases';
import { ErrorLine, StateBadge, When, errText, personLabel, useApi, usePeople, useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

export function DeployHistory({ deployments }: { deployments: Deployment[] }) {
  const { t, organizationId, projectId } = useReleases();
  const people = usePeople([organizationId, projectId]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deployments;
    return deployments.filter((d) =>
      [d.product, d.environment_name, d.namespace, d.commit, d.requested_by_name, d.requested_by, d.state]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    );
  }, [deployments, query]);
  if (deployments.length === 0) return <p className={styles.muted}>{t('nothing_deployed')}</p>;
  return (
    <section className={styles.card} data-deploy-history>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search_deploys')}
        aria-label={t('search_deploys')}
        className={styles.search}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col_state')}</TableHead>
            <TableHead>{t('col_what')}</TableHead>
            <TableHead>{t('col_where')}</TableHead>
            <TableHead>{t('col_commit')}</TableHead>
            <TableHead>{t('col_by')}</TableHead>
            <TableHead>{t('col_when')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d) => (
            <Fragment key={d.id}>
              <TableRow
                className={styles.clickable}
                aria-expanded={open === d.id}
                onClick={() => setOpen(open === d.id ? null : d.id)}
                data-deploy-history-row={d.id}
              >
                <TableCell>
                  <StateBadge d={d} />
                </TableCell>
                <TableCell>
                  <b>{d.product}</b>
                  {versionOf(d) ? <span className={styles.muted}> · {versionOf(d)}</span> : null}{' '}
                  {d.preview && <Badge variant="outline">{t('preview_badge', { name: d.preview.name })}</Badge>}
                  {(d.action ?? 'install') === 'uninstall' && <Badge variant="outline">{t('taken_out')}</Badge>}
                </TableCell>
                <TableCell>
                  {d.environment_name}{' '}
                  <span className={styles.muted}>
                    · <code>{d.namespace}</code>
                  </span>
                </TableCell>
                <TableCell>{d.commit ? <code>{shortCommit(d.commit)}</code> : '—'}</TableCell>
                <TableCell>{personLabel(d.requested_by, d.requested_by_name, people, t)}</TableCell>
                <TableCell>
                  <When iso={d.requested_at} />
                </TableCell>
              </TableRow>
              {open === d.id && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className={styles.stack} data-deploy-history-detail={d.id}>
                      {d.decided_at && (
                        <div className={styles.muted}>
                          {t(d.state === 'declined' ? 'declined_by' : 'approved_by', {
                            who: personLabel(d.decided_by, d.decided_by_name, people, t),
                          })}
                        </div>
                      )}
                      {d.reason && <div className={styles.muted}>“{d.reason}”</div>}
                      {d.outcome && <pre className={styles.outcome}>{d.outcome}</pre>}
                      {canReadStatus(d) && <StatusButton d={d} />}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** The rollout read back from the cluster, on demand. */
function StatusButton({ d }: { d: Deployment }) {
  const { t, organizationId } = useReleases();
  const api = useApi();
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.deploymentStatus({ organizationId, id: d.id }).fetch({ staleTime: 0 }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.stack}>
      <span>
        <Button size="sm" variant="ghost" disabled={busy || !organizationId} onClick={() => void read()} data-deployment-status>
          {busy ? t('status_asking') : status ? t('status_again') : t('status_read')}
        </Button>
      </span>
      {error && <ErrorLine>{error}</ErrorLine>}
      {status && (
        <ul className={styles.list}>
          {status.workloads.length === 0 && <li className={styles.muted}>{t('no_workloads', { namespace: d.namespace })}</li>}
          {status.workloads.map((w) => (
            <li key={w.name}>
              <Badge variant={w.ready >= w.desired ? 'success' : 'warning'}>
                {w.ready}/{w.desired}
              </Badge>{' '}
              {w.name} <span className={styles.muted}>{w.images.join(', ')}</span>
            </li>
          ))}
          {(status.problems ?? []).map((p) => (
            <li key={p} className={styles.error} data-deployment-problem>
              {p}
            </li>
          ))}
          {status.hosts.map((h) => (
            <li key={h}>
              <a href={`https://${h}`} target="_blank" rel="noreferrer">
                {h}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
