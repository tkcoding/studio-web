/**
 * Organization › Background work — the prototype's tasks.tsx carried over
 * (ADR-0069 parity): the runs `studio-tasks` keeps and the schedules
 * `studio-scheduler` fires.
 *
 * Two lists, because they answer different questions. **Runs** is "what has
 * this deployment been doing, and what went wrong". **Schedules** is "what
 * fires on its own", with the one control a person needs: run it now. The
 * runs open on what failed and what is running; a scheduled task's succeeded
 * runs fold into one row.
 *
 * `studio-tasks` announces every run transition on `studio-events`, and the
 * shell relays its one subscription to this screen: the list reads itself
 * again when a run moves. The poll stays as a floor while a run on screen is
 * still moving — it covers a deployment without the channel, as in the
 * prototype.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry, useSharedProperty, FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { isRunEvent, useStudioEventRefresh } from '@constructor-studio/mfe-shared';
import { BackgroundApiService } from '../../api/BackgroundApiService';
import {
  ATTENTION_STATES,
  EVERY_STATE,
  STATES,
  duration,
  finished,
  foldRecurring,
  headline,
  mergePages,
  stateTone,
  type ShownRun,
  type Tone,
} from '../../background/model';
import type { TaskRun, TaskSchedule } from '../../background/types';
import { useBackgroundTranslations } from '../../i18n';
import styles from './BackgroundScreen.module.css';

type Text = ReturnType<typeof useBackgroundTranslations>['t'];

const PAGE = 50;
const LIVE_POLL_MS = 4000;

const VARIANT: Record<Tone, 'success' | 'info' | 'danger' | 'warning' | 'secondary'> = {
  ok: 'success',
  running: 'info',
  danger: 'danger',
  warn: 'warning',
  neutral: 'secondary',
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function when(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(language);
}

interface Page {
  at: number;
  items: ShownRun[];
  total: number;
}

export const BackgroundScreen: React.FC = () => {
  const { t, loading } = useBackgroundTranslations();
  const published = useSharedProperty(FRONTX_SHARED_PROPERTY_LANGUAGE);
  const language = typeof published === 'string' && published ? published : 'en';
  const api = apiRegistry.getService(BackgroundApiService);

  const [state, setState] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<string>('');
  const [limit, setLimit] = useState(PAGE);
  const [tick, setTick] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<string, number>>>({});
  const [types, setTypes] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<TaskSchedule[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const recurring = useMemo(() => new Set((schedules ?? []).map((sc) => sc.task_type)), [schedules]);

  useEffect(() => {
    let alive = true;
    api.taskTypes.fetch().then(
      (r) => alive && setTypes(r.items),
      () => alive && setTypes([])
    );
    return () => {
      alive = false;
    };
  }, [api]);

  // The scheduler is optional: its absence is an empty list, not an error.
  useEffect(() => {
    let alive = true;
    api.schedules.fetch({ staleTime: 0 }).then(
      (r) => alive && setSchedules(r.items),
      () => alive && setSchedules([])
    );
    return () => {
      alive = false;
    };
  }, [api, tick]);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      STATES.map((st) =>
        api
          .runs({ state: st, limit: 1 })
          .fetch({ staleTime: 0 })
          .then(
            (r) => [st, r.total ?? r.items.length] as const,
            () => null
          )
      )
    ).then((pairs) => {
      if (!alive) return;
      const next: Partial<Record<string, number>> = {};
      for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
      setCounts(next);
    });
    return () => {
      alive = false;
    };
  }, [api, tick]);

  useEffect(() => {
    let alive = true;
    const read = async (): Promise<Page> => {
      const typeFilter = taskType || undefined;
      if (!state) {
        // The default: failed and running together. The backend narrows by one
        // state, so it is asked once per state and the pages merged.
        const pages = await Promise.all(
          ATTENTION_STATES.map((st) => api.runs({ state: st, taskType: typeFilter, limit }).fetch({ staleTime: 0 }))
        );
        return {
          at: Date.now(),
          items: mergePages(
            pages.map((p) => p.items),
            0,
            limit
          ),
          total: pages.reduce((n, p) => n + (p.total ?? p.items.length), 0),
        };
      }
      const r = await api
        .runs({ state: state === EVERY_STATE ? undefined : state, taskType: typeFilter, limit })
        .fetch({ staleTime: 0 });
      return { at: Date.now(), items: foldRecurring(r.items, recurring), total: r.total ?? r.items.length };
    };
    read().then(
      (p) => {
        if (!alive) return;
        setPage(p);
        setError(null);
        setUnavailable(false);
      },
      (e: unknown) => {
        if (!alive) return;
        const text = message(e);
        // 503: studio-tasks has no database here — a configuration fact.
        if (text.includes('not available in this deployment') || text.includes('503')) setUnavailable(true);
        else setError(text);
      }
    );
    return () => {
      alive = false;
    };
  }, [api, state, taskType, limit, recurring, tick]);

  useStudioEventRefresh(isRunEvent, refresh);

  const live = !!page?.items.some((r) => r.state === 'queued' || r.state === 'running');
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  const act = async (run: TaskRun, what: 'cancel' | 'retry') => {
    if (what === 'cancel' && !window.confirm(t('cancel_confirm', { task: run.task_type, id: run.id.slice(0, 8) })))
      return;
    try {
      await (what === 'cancel' ? api.cancel(run.id) : api.retry(run.id)).fetch(undefined);
    } catch (e) {
      setError(t('action_failed', { error: message(e) }));
    }
    refresh();
  };

  const runNow = async (sc: TaskSchedule) => {
    try {
      await api.runNow(sc.id).fetch(undefined);
    } catch (e) {
      setError(t('action_failed', { error: message(e) }));
    }
    refresh();
  };

  if (loading) return null;

  return (
    <div className={styles.screen} data-background-work>
      <header className={styles.header}>
        <h2 className={styles.title} title={t('about')}>
          {t('title')}
        </h2>
        <div className={styles.chips}>
          {(counts.running ?? 0) > 0 && <Badge variant="info">{t('count_running', { count: counts.running ?? 0 })}</Badge>}
          {(counts.queued ?? 0) > 0 && (
            <Badge variant="secondary">{t('count_queued', { count: counts.queued ?? 0 })}</Badge>
          )}
          {(counts.failed ?? 0) > 0 && <Badge variant="danger">{t('count_failed', { count: counts.failed ?? 0 })}</Badge>}
          {counts.running === 0 && counts.failed === 0 && <Badge variant="success">{t('all_quiet')}</Badge>}
          {schedules && schedules.length > 0 && (
            <span className={styles.muted}>· {t('schedules_count', { count: schedules.length })}</span>
          )}
        </div>
      </header>
      <p className={styles.about}>{t('about')}</p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {unavailable && <p className={styles.muted}>{t('unavailable')}</p>}

      <Card data-background-runs>
        <CardHeader>
          <CardTitle>{t('runs')}</CardTitle>
        </CardHeader>
        <CardContent className={styles.body}>
          <div className={styles.filters} role="group" aria-label={t('col_state')}>
            <FilterChip on={state === null} onClick={() => setState(null)}>
              {t('filter_attention')}
            </FilterChip>
            {STATES.map((st) => (
              <FilterChip key={st} on={state === st} onClick={() => setState(st)}>
                {t(`state_${st}`)}
                {counts[st] !== undefined && <span className={styles.chipCount}>{counts[st]}</span>}
              </FilterChip>
            ))}
            <FilterChip on={state === EVERY_STATE} onClick={() => setState(EVERY_STATE)}>
              {t('filter_every')}
            </FilterChip>
            {types.length > 0 && (
              <select
                className={styles.select}
                value={taskType}
                aria-label={t('filter_every_type')}
                onChange={(e) => setTaskType(e.target.value)}
              >
                <option value="">{t('filter_every_type')}</option>
                {types.map((ty) => (
                  <option key={ty} value={ty}>
                    {ty}
                  </option>
                ))}
              </select>
            )}
            {live && <span className={styles.muted}>{t('live')}</span>}
          </div>

          {page && page.items.length === 0 ? (
            <p className={styles.muted}>{t('runs_empty')}</p>
          ) : (
            page && (
              <Table data-background-runs-table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_task')}</TableHead>
                    <TableHead>{t('col_state')}</TableHead>
                    <TableHead>{t('col_what')}</TableHead>
                    <TableHead>{t('col_tries')}</TableHead>
                    <TableHead>{t('col_took')}</TableHead>
                    <TableHead>{t('col_started')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      now={page.at}
                      cadence={schedules?.find((sc) => sc.task_type === run.task_type)?.expression}
                      open={open === run.id}
                      onToggle={() => setOpen(open === run.id ? null : run.id)}
                      onAct={act}
                      t={t}
                      language={language}
                    />
                  ))}
                </TableBody>
              </Table>
            )
          )}
          {page && page.total > page.items.length && page.items.length >= limit && (
            <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              {t('more')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card data-background-schedules>
        <CardHeader>
          <CardTitle>{t('schedules')}</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules && schedules.length === 0 ? (
            <p className={styles.muted}>{t('schedules_empty')}</p>
          ) : (
            schedules && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_schedule')}</TableHead>
                    <TableHead>{t('col_runs')}</TableHead>
                    <TableHead>{t('col_cadence')}</TableHead>
                    <TableHead>{t('col_policies')}</TableHead>
                    <TableHead>{t('col_next')}</TableHead>
                    <TableHead>{t('col_last')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...schedules]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((sc) => (
                      <TableRow key={sc.id} data-schedule={sc.id}>
                        <TableCell>
                          <b>{sc.name}</b> {!sc.enabled && <Badge variant="warning">{t('disabled')}</Badge>}
                        </TableCell>
                        <TableCell className={styles.muted}>{sc.task_type}</TableCell>
                        <TableCell className={styles.muted}>
                          {sc.expression}
                          <div>
                            {sc.expression_kind} · {sc.timezone}
                          </div>
                        </TableCell>
                        <TableCell className={styles.muted}>
                          {sc.concurrency} · {sc.missed_policy}
                          {sc.missed_policy === 'backfill' && ` (≤${sc.max_catch_up_runs})`}
                        </TableCell>
                        <TableCell>{when(sc.next_run_at, language)}</TableCell>
                        <TableCell>{when(sc.last_fired_at, language)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => void runNow(sc)}>
                            {t('run_now')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
};

BackgroundScreen.displayName = 'BackgroundScreen';

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`${styles.chip} ${on ? styles.chipOn : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function RunRow({
  run,
  now,
  cadence,
  open,
  onToggle,
  onAct,
  t,
  language,
}: {
  run: ShownRun;
  now: number;
  cadence: string | undefined;
  open: boolean;
  onToggle: () => void;
  onAct: (run: TaskRun, what: 'cancel' | 'retry') => void;
  t: Text;
  language: string;
}) {
  return (
    <>
      <TableRow data-run={run.state} onClick={onToggle} className={styles.clickable}>
        <TableCell>
          <b>{run.task_type}</b>
          <div className={styles.muted}>
            {run.folded !== undefined ? (
              <>
                {t('folded', { cadence: cadence ?? t('scheduled') })}
                {run.folded > 0 && ` · ${t('folded_more', { count: run.folded })}`}
              </>
            ) : (
              run.id.slice(0, 8)
            )}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={VARIANT[stateTone(run.state)]}>{t(`state_${run.state}`)}</Badge>
          {run.cancel_requested && !finished(run) && <div className={styles.muted}>{t('stop_requested')}</div>}
        </TableCell>
        <TableCell className={styles.muted}>{headline(run)}</TableCell>
        <TableCell>{run.attempts}</TableCell>
        <TableCell className={styles.muted}>{duration(run, now)}</TableCell>
        <TableCell>{when(run.started_at ?? run.created_at, language)}</TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {(run.state === 'failed' || run.state === 'cancelled') && (
            <Button variant="ghost" size="sm" onClick={() => onAct(run, 'retry')}>
              {t('retry')}
            </Button>
          )}
          {!finished(run) && (
            <Button variant="ghost" size="sm" disabled={run.cancel_requested} onClick={() => onAct(run, 'cancel')}>
              {t('cancel')}
            </Button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className={styles.detailRow}>
          <TableCell colSpan={7}>
            <dl className={styles.details}>
              <dt>{t('detail_id')}</dt>
              <dd>{run.id}</dd>
              <dt>{t('detail_by')}</dt>
              <dd>{run.requested_by}</dd>
              {run.partition_key && (
                <>
                  <dt>{t('detail_partition')}</dt>
                  <dd>{run.partition_key}</dd>
                </>
              )}
              <dt>{t('detail_created')}</dt>
              <dd>{when(run.created_at, language)}</dd>
              <dt>{t('detail_finished')}</dt>
              <dd>{when(run.finished_at, language)}</dd>
              {run.progress && (
                <>
                  <dt>{t('detail_progress')}</dt>
                  <dd>{run.progress}</dd>
                </>
              )}
              {run.last_error && (
                <>
                  <dt>{t('detail_error')}</dt>
                  <dd>{run.last_error}</dd>
                </>
              )}
              <dt>{t('detail_payload')}</dt>
              <dd>
                <pre className={styles.json}>{JSON.stringify(run.payload, null, 2)}</pre>
              </dd>
              {run.result && (
                <>
                  <dt>{t('detail_result')}</dt>
                  <dd>
                    <pre className={styles.json}>{JSON.stringify(run.result, null, 2)}</pre>
                  </dd>
                </>
              )}
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
