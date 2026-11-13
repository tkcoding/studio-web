/**
 * The ladder (ADR-0056 §4), the prototype's ReleaseLadder, StepDetail,
 * DeployProgress and PromoteBuild (releases-tab.tsx at 00828880): the newest
 * published build, then a row per environment in the order a release climbs
 * them -- what runs there, how its newest deploy went, what it takes from,
 * and the action that applies: Promote what the environment before it runs,
 * or Deploy… which opens the environment's actions under the row. A row
 * opens on its newest deploy as the deploy tells it.
 */

import React, { Fragment, useEffect, useState } from 'react';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@gears-frontx/ui-kit';
import type { Connection, Deployment, DeploymentStatus, ProjectTargets, TaskRun } from '../../api/types';
import type { IdeBuild } from '../../model/builds';
import { productUrls, profilesBoundTo } from '../../model/project-deploys';
import { newestRelease, stepStatus, versionOf, type LadderStep } from '../../model/releases';
import { RungPlace, useDeployRequest } from './DeployActions';
import { ErrorLine, TONE_BADGE, When, personLabel, relTime, useApi, usePeople, useReleases, type Tone } from './parts';
import styles from './ReleasesScreen.module.css';

/** A ladder step's tone (releases.ts) as a chip's. */
const LADDER_TONE: Record<ReturnType<typeof stepStatus>['tone'], Tone> = {
  ok: 'ok',
  warn: 'warn',
  bad: 'danger',
  idle: 'neutral',
};

export function ReleaseLadder({
  steps,
  bindings,
  open,
  onOpen,
  onChanged,
  panel,
}: {
  steps: LadderStep[];
  bindings: ProjectTargets['bindings'];
  /** The environment whose Deploy… panel is open. */
  open: string | null;
  onOpen: (environment: string) => void;
  onChanged: (message: string) => void;
  /** What Deploy… opens under an environment's row. */
  panel: (step: LadderStep) => React.ReactNode;
}) {
  const { t, language, projectId } = useReleases();
  const api = useApi();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Every rung asks which place it stands on: read once for the ladder.
  const [connections, setConnections] = useState<Connection[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .connections({ tenantId: projectId })
      .fetch({ staleTime: 60_000 })
      .then((r) => live && setConnections(r.items))
      .catch(() => live && setConnections([]));
    return () => {
      live = false;
    };
  }, [api, projectId]);
  const newest = newestRelease(steps);
  return (
    <section className={styles.card} data-release-ladder>
      <div className={styles.muted} data-ladder-build>
        {t('newest_build')}{' '}
        {newest ? (
          <>
            <b>{newest.chartVersion ?? newest.buildId}</b> · {newest.where} ·{' '}
            {relTime(newest.finishedAt ?? newest.startedAt ?? '', language)}
          </>
        ) : (
          t('nothing_published')
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col_environment')}</TableHead>
            <TableHead>{t('col_status')}</TableHead>
            <TableHead>{t('col_runs')}</TableHead>
            <TableHead>{t('col_takes_from')}</TableHead>
            <TableHead>{t('col_last_deploy')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((s) => {
            const id = s.environment.id;
            const status = stepStatus(s);
            return (
              <Fragment key={id}>
                <TableRow
                  className={styles.clickable}
                  onClick={() => setExpanded(expanded === id ? null : id)}
                  aria-expanded={expanded === id}
                  data-ladder-row={s.environment.name}
                >
                  <TableCell>
                    <span className={styles.chips} data-ladder-step={s.environment.name} data-ladder-state={s.state}>
                      <b>{s.environment.name}</b>
                      {s.environment.protected && <Badge variant="info">{t('needs_approval')}</Badge>}
                      {s.environment.project_id && (
                        <Badge variant="secondary" data-own-environment>
                          {t('projects_own')}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={TONE_BADGE[s.state === 'deploying' ? 'running' : LADDER_TONE[status.tone]]}
                      data-ladder-status
                    >
                      {status.text}
                    </Badge>
                    {s.state === 'deploying' && s.latest && (
                      <DeployProgress deployment={s.latest} onEnded={onChanged} />
                    )}
                  </TableCell>
                  <TableCell>
                    {s.runs ? (
                      <>
                        <code>{versionOf(s.runs) ?? s.runs.product}</code>
                        {productUrls(s.runs.outcome).map((u) => (
                          <div key={u}>
                            <a
                              href={u}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              data-product-url
                            >
                              {t('open_product')}
                            </a>
                          </div>
                        ))}
                      </>
                    ) : (
                      <span className={styles.muted}>{t('nothing')}</span>
                    )}
                  </TableCell>
                  <TableCell>{s.from ?? <span className={styles.muted}>{t('a_build')}</span>}</TableCell>
                  <TableCell>
                    <When iso={s.latest?.requested_at} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <span className={styles.ladderActions}>
                      {s.promote && <PromoteBuild step={s} build={s.promote} onChanged={onChanged} />}
                      <Button
                        size="sm"
                        variant={s.promote ? 'ghost' : 'default'}
                        aria-expanded={open === id}
                        title={t('deploy_open_title')}
                        onClick={() => onOpen(id)}
                        data-ladder-deploy
                      >
                        {t('deploy_open')}
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
                {expanded === id && (
                  <TableRow data-ladder-expanded={s.environment.name}>
                    <TableCell colSpan={6}>
                      <StepDetail step={s} bindings={bindings} connections={connections} />
                    </TableCell>
                  </TableRow>
                )}
                {open === id && (
                  <TableRow data-ladder-panel={s.environment.name}>
                    <TableCell colSpan={6}>{panel(s)}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

/** An environment's row, opened: where it is, which profile it runs, and its
 *  newest deploy as that deploy tells it -- the reason it was asked for and
 *  its outcome, a crashed container's error first. */
function StepDetail({
  step: s,
  bindings,
  connections,
}: {
  step: LadderStep;
  bindings: ProjectTargets['bindings'];
  connections: Connection[] | null;
}) {
  const { t, language, organizationId, projectId } = useReleases();
  const e = s.environment;
  const profiles = profilesBoundTo(bindings, e.id);
  const people = usePeople([organizationId, projectId]);
  return (
    <div className={styles.stack} data-ladder-detail={e.name}>
      <RungPlace step={s} connections={connections} />
      <div className={styles.muted}>
        {e.kind === 'research' ? (
          <>
            {t('research_application')} <code>{s.namespace}</code> {t('in_research_project')} <code>{e.research_project}</code>
          </>
        ) : (
          <>
            {t('namespace')} <code>{s.namespace}</code>
          </>
        )}
        {s.from && <> · {t('takes_from', { environment: s.from })}</>}
        {' · '}
        {profiles.length ? t('profile_bound', { profiles: profiles.join(', ') }) : t('no_profile_bound')}
      </div>
      {s.latest ? (
        <div data-ladder-latest={s.latest.state}>
          <div className={styles.muted}>
            {t('newest_deploy')} <b>{versionOf(s.latest) ?? s.latest.product}</b> · {s.latest.state} ·{' '}
            {personLabel(s.latest.requested_by, s.latest.requested_by_name, people, t)} ·{' '}
            {relTime(s.latest.requested_at, language)}
          </div>
          {s.latest.reason && <div className={styles.muted}>“{s.latest.reason}”</div>}
          {s.latest.outcome && <pre className={styles.outcome}>{s.latest.outcome}</pre>}
        </div>
      ) : (
        <div className={styles.muted}>{t('nothing_deployed_here')}</div>
      )}
    </div>
  );
}

/** How often a deploy under way is read again. */
const PROGRESS_MS = 4000;

/** Where a deploy that is under way is: waiting for a runner, the phase its
 *  run reported, and how many of the release's pods are ready. Read again
 *  every few seconds; the screen reads again once the deploy ends. */
function DeployProgress({ deployment, onEnded }: { deployment: Deployment; onEnded: (message: string) => void }) {
  const { t, organizationId } = useReleases();
  const api = useApi();
  const [run, setRun] = useState<TaskRun | null>(null);
  const [rollout, setRollout] = useState<DeploymentStatus | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const look = async () => {
      const [r, st] = await Promise.all([
        deployment.run_id && organizationId
          ? api
              .taskRun({ runId: deployment.run_id, tenantId: organizationId })
              .fetch({ staleTime: 0 })
              .catch(() => null)
          : null,
        organizationId
          ? api
              .deploymentStatus({ organizationId, id: deployment.id })
              .fetch({ staleTime: 0 })
              .catch(() => null)
          : null,
      ]);
      if (!live) return;
      setNow(Date.now());
      setRun(r);
      setRollout(st);
      const ended = st?.deployment.state ?? (r && ['succeeded', 'failed', 'cancelled'].includes(r.state) ? r.state : null);
      if (ended && ended !== 'queued' && ended !== 'running' && ended !== 'awaiting_approval') {
        live = false;
        onEnded(
          t('deploy_ended', {
            version: versionOf(deployment) ?? deployment.product,
            environment: deployment.environment_name,
            state: ended,
          })
        );
      }
    };
    void look();
    const timer = window.setInterval(() => void look(), PROGRESS_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api, organizationId, deployment, onEnded, t]);
  const workloads = rollout?.workloads ?? [];
  const desired = workloads.reduce((n, w) => n + Math.max(w.desired, 0), 0);
  const ready = workloads.reduce((n, w) => n + Math.max(Math.min(w.ready, w.desired), 0), 0);
  const since = run?.started_at ?? deployment.decided_at ?? deployment.requested_at;
  const seconds = since && now !== null ? Math.max(0, Math.round((now - Date.parse(since)) / 1000)) : null;
  const phase = !run || run.state === 'queued' ? t('waiting_for_runner') : (run.progress ?? t('starting'));
  return (
    <div className={styles.progress} data-deploy-progress>
      {desired > 0 ? (
        <progress max={desired} value={ready} aria-label={t('pods_ready_label')} />
      ) : (
        <progress aria-label={t('deploy_under_way')} />
      )}
      <div className={styles.muted}>
        {phase}
        {desired > 0 && <> · {t('pods_ready', { ready, desired })}</>}
        {seconds !== null && <> · {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</>}
      </div>
      {(rollout?.problems ?? []).slice(0, 3).map((p) => (
        <div key={p} className={styles.warn}>
          {p}
        </div>
      ))}
    </div>
  );
}

/** Promote: deploy here the build the environment before it runs. */
function PromoteBuild({ step, build, onChanged }: { step: LadderStep; build: IdeBuild; onChanged: (message: string) => void }) {
  const { t } = useReleases();
  const { busy, error, ask } = useDeployRequest(onChanged);
  const version = build.chartVersion ?? build.buildId;
  const replaces = step.runs ? versionOf(step.runs) : null;
  return (
    <>
      <Button
        size="sm"
        disabled={busy}
        title={
          replaces
            ? t('promote_title_replaces', { version, from: step.from ?? '', environment: step.environment.name, replaces })
            : t('promote_title', { version, from: step.from ?? '', environment: step.environment.name })
        }
        onClick={() =>
          void ask(
            { environment_id: step.environment.id, build: build.buildId },
            t('what_promote', { version, environment: step.environment.name })
          )
        }
        data-ladder-promote
      >
        {t('promote', { version })}
      </Button>
      {error && <ErrorLine>{error}</ErrorLine>}
    </>
  );
}
