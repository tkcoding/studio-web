/**
 * What runs where (ADR-0056 §2): the deploys waiting for an administrator's
 * decision, with Approve and Decline, and a table of projects by
 * environments — per cell what runs and, beside it, the newest deploy when
 * that is not what runs. The prototype's "What runs where" tab of
 * OrgInfrastructure (environments-screen.tsx at 00828880).
 */

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyHeader,
  EmptyTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import type { DeployEnvironment, Deployment } from '../../api/types';
import { STATE_LABELS, stateTone } from '../../model/environments';
import { versionOf, type ProjectRuns } from '../../model/releases';
import { DeploymentLine, STATE_BADGE, errText, relTime, useApi, useInfra, type PeopleNames } from './parts';
import styles from './InfrastructureScreen.module.css';

export function WhatRunsWhere({
  waiting,
  ladder,
  rows,
  mayManage,
  people,
  onDecided,
}: {
  waiting: Deployment[];
  ladder: DeployEnvironment[];
  /** `null` while the environments are read. */
  rows: ProjectRuns[] | null;
  mayManage: boolean;
  people: PeopleNames;
  /** A decision was made: what it said, and the page reads its deploys again. */
  onDecided: (notice: string) => void;
}) {
  const { t, org, language } = useInfra();
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const decide = async (d: Deployment, action: 'approve' | 'decline') => {
    setBusy(d.id);
    setError(null);
    try {
      await api
        .decideDeployment(org.id, d.id)
        .fetch(action === 'approve' ? { action } : { action, reason: reason.trim() });
      if (action === 'decline') {
        setDeclining(null);
        setReason('');
      }
      onDecided(
        action === 'approve'
          ? t('approved_notice', { product: d.product, environment: d.environment_name })
          : t('declined_notice', { product: d.product, environment: d.environment_name })
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.stack} data-what-runs-where>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {waiting.length > 0 && (
        <Card data-deploys-awaiting>
          <CardContent className={styles.cardBody}>
            <h3 className={styles.formTitle}>{t('waiting_title')}</h3>
            <ul className={styles.list}>
              {waiting.map((d) => (
                <li key={d.id} data-deploy-awaiting={d.id}>
                  <DeploymentLine d={d} showProject people={people} />
                  {mayManage ? (
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        disabled={busy === d.id}
                        data-deploy-approve
                        onClick={() => void decide(d, 'approve')}
                      >
                        {t('approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === d.id}
                        onClick={() => setDeclining(declining === d.id ? null : d.id)}
                        data-deploy-decline-open
                      >
                        {t('decline_open')}
                      </Button>
                      {declining === d.id && (
                        <>
                          <Input
                            className={styles.grow}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={t('decline_reason_placeholder')}
                            aria-label={t('decline_reason')}
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy === d.id || !reason.trim()}
                            onClick={() => void decide(d, 'decline')}
                            data-deploy-decline
                          >
                            {t('decline')}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className={styles.hint}>{t('admin_decides')}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card data-runs-where>
        <CardContent className={styles.cardBody}>
          {rows === null ? (
            <p className={styles.hint}>{t('loading')}</p>
          ) : rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('nothing_runs')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_project')}</TableHead>
                  {ladder.map((e) => (
                    <TableHead key={e.id}>{e.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.projectId} data-runs-row={r.projectName}>
                    <TableCell>
                      <b>{r.projectName}</b>
                    </TableCell>
                    {ladder.map((e) => {
                      const cell = r.cells.get(e.id);
                      if (!cell)
                        return (
                          <TableCell key={e.id}>
                            <span className={styles.muted}>—</span>
                          </TableCell>
                        );
                      const runs = cell.runs ? versionOf(cell.runs) : null;
                      const asked = versionOf(cell.latest);
                      // What runs, as a chip; the newest deploy beside it when it
                      // is not what runs: waiting, deploying, failed, taken out.
                      return (
                        <TableCell key={e.id}>
                          <div
                            className={styles.chipRow}
                            data-runs-cell={`${r.projectName}/${e.name}`}
                            title={t('newest_deploy', { when: relTime(cell.latest.requested_at, language) })}
                          >
                            {runs ? (
                              <Badge variant="success">{runs}</Badge>
                            ) : (
                              <span className={styles.muted}>{t('nothing_runs_cell')}</span>
                            )}
                            {cell.latest.id !== cell.runs?.id && (
                              <Badge
                                variant={STATE_BADGE[stateTone(cell.latest.state)]}
                                data-deployment-state={cell.latest.state}
                              >
                                {asked ? `${asked} · ` : ''}
                                {STATE_LABELS[cell.latest.state] ?? cell.latest.state}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
