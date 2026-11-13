/**
 * One deploy, opened by itself (#1054): what it is, how it went, why it
 * failed and what fixes that, the end of its log, and where it answers. The
 * Inbox's "A Research deploy you asked for failed" leads here
 * (`…&deployment=<id>`), and so do a path step's "Open the deploy" and a
 * cause's "Open the log". Read again while it runs.
 */

import { useEffect, useState } from 'react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import type { ContainerLog, Deployment, PathAction } from '../../api/types';
import { ended, type Intent } from '../../model/path';
import { CauseView } from './ProjectPath';
import { ErrorLine, StateBadge, When, errText, useApi, useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

/** How often a deploy that runs is read again. */
const FOLLOW_MS = 4000;

export function DeploymentDetail({
  id,
  onClose,
  onIntent,
}: {
  id: string;
  onClose: () => void;
  onIntent: (intent: Intent, action: Partial<PathAction>) => void;
}) {
  const { t, projectId, organizationId } = useReleases();
  const api = useApi();
  const [d, setD] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<ContainerLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .deployment({ projectId, id })
      .fetch({ staleTime: 0 })
      .then((x) => {
        if (!live) return;
        setD(x);
        setError(null);
      })
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, projectId, id, round]);

  // The log once the organization is known; a deploy whose pods are gone has none.
  useEffect(() => {
    if (!organizationId || !d) return;
    let live = true;
    api
      .deploymentLogs({ organizationId, id })
      .fetch({ staleTime: 0 })
      .then((l) => live && setLogs(l.containers ?? []))
      .catch(() => live && setLogs([]));
    return () => {
      live = false;
    };
  }, [api, organizationId, id, d]);

  const running = !!d && !ended(d.state);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setRound((r) => r + 1), FOLLOW_MS);
    return () => window.clearTimeout(timer);
  }, [running, round]);

  return (
    <section className={styles.card} data-deployment-detail={id}>
      <div className={styles.headRow}>
        <h2 className={styles.cardTitle}>
          {d ? t('deployment_title', { environment: d.environment_name }) : t('loading')}
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {d && (
        <>
          <div className={styles.row}>
            <StateBadge d={d} />
            {d.research && <Badge variant="secondary">{t('target_research')}</Badge>}
            <span className={styles.muted}>
              {d.chart_version ?? d.build ?? ''} · {d.requested_by_name || d.requested_by} · <When iso={d.requested_at} />
            </span>
          </div>
          {d.public_url && d.state === 'succeeded' && (
            <p data-deployment-url>
              {t('runs_at')}{' '}
              <a className={styles.link} href={d.public_url} target="_blank" rel="noreferrer">
                {d.public_url}
              </a>
            </p>
          )}
          {d.cause && <CauseView cause={d.cause} deploymentId={d.id} onIntent={onIntent} />}
          {!d.cause && d.outcome && <p className={`${styles.muted} ${styles.pre}`}>{d.outcome}</p>}
          <details className={styles.section} open={d.state === 'failed'} data-deployment-log>
            <summary className={styles.summary}>{t('deployment_log')}</summary>
            {logs === null ? (
              <p className={styles.muted}>{t('loading')}</p>
            ) : logs.length === 0 ? (
              <p className={`${styles.muted} ${styles.pre}`}>{d.outcome || t('deployment_no_log')}</p>
            ) : (
              logs.map((l) => (
                <div key={`${l.pod}/${l.container}/${l.previous}`} className={styles.stack}>
                  <span className={styles.mono}>
                    {l.pod} / {l.container}
                    {l.previous ? ` (${t('deployment_log_previous')})` : ''}
                  </span>
                  <pre className={`${styles.log} ${styles.pre}`}>{l.text}</pre>
                </div>
              ))
            )}
          </details>
        </>
      )}
    </section>
  );
}
