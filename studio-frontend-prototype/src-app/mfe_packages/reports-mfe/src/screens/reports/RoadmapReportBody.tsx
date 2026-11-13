/**
 * The roadmap report as the Reports screen draws it (the prototype's
 * roadmap-report-view.tsx `RoadmapReportBody`): what the board plans, whether
 * the plan holds — the counts, by group, stage, plan, milestone and consumer,
 * the overdue milestones and a row per planned gear. Every number is the
 * server's (`studio-reports`, the last board sync and the plan the last
 * refresh read). `version` reads it again.
 */

import { useEffect, useState } from 'react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { apiRegistry } from '@gears-frontx/react';
import { ReportsApiService } from '../../api/ReportsApiService';
import { demandText, type RoadmapGroup, type RoadmapReport } from '../../model/roadmap-report';
import { KpiTile, StatusChip, errText, type Text, type Tone } from './parts';
import styles from './ReportsScreen.module.css';

/** A plan lamp as a chip tone. */
const LAMP: Record<string, Tone> = { good: 'ok', watch: 'warn', bad: 'danger' };

/** The progress axes across the groups, in board order. */
function axisLabels(groups: RoadmapGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) for (const a of g.axes) if (!out.includes(a.label)) out.push(a.label);
  return out;
}

export function RoadmapReportBody({
  organizationId,
  version,
  t,
}: {
  organizationId: string;
  version: number;
  t: Text;
}) {
  const [read, setRead] = useState<{ version: number; report: RoadmapReport | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(ReportsApiService)
      .summary({ organizationId, reportId: 'roadmap' })
      .fetch({ staleTime: 0 })
      .then((report) => live && setRead({ version, report, error: null }))
      .catch((e: unknown) => live && setRead({ version, report: null, error: errText(e) }));
    return () => {
      live = false;
    };
  }, [organizationId, version]);

  const report = read?.report ?? null;
  const s = report?.summary;
  const axes = s ? axisLabels(s.by_group) : [];
  return (
    <div className={styles.roadmap} data-roadmap>
      {read?.error && (
        <p role="alert" className={styles.error}>
          {read.error}
        </p>
      )}
      {!read && <p className={styles.muted}>{t('reading_board')}</p>}
      {report && s && (
        <>
          <div className={styles.kpis} data-roadmap-counts>
            <KpiTile label={t('kpi_on_board')} value={report.total} />
            <KpiTile label={t('kpi_not_in_code')} value={report.not_in_code} tone={report.not_in_code > 0 ? 'warn' : undefined} />
            <KpiTile
              label={t('kpi_not_on_board')}
              value={report.not_on_board}
              tone={report.not_on_board > 0 ? 'warn' : undefined}
              sub={report.not_on_board > 0 ? t('kpi_not_on_board_sub') : undefined}
            />
          </div>
          {report.total === 0 ? (
            <Empty data-roadmap-empty>
              <EmptyHeader>
                <EmptyTitle>{t('no_gears_title')}</EmptyTitle>
                <EmptyDescription>{t('no_gears_body')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              {s.by_group.length > 0 && (
                <section className={styles.scroll}>
                  <h3 className={styles.h3}>{t('by_group')}</h3>
                  <Table className={styles.small} data-roadmap-groups>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead>{t('col_gears')}</TableHead>
                        <TableHead>{t('col_done')}</TableHead>
                        <TableHead>{t('col_in_code')}</TableHead>
                        {axes.map((l) => (
                          <TableHead key={l}>{l}</TableHead>
                        ))}
                        <TableHead>{t('col_estimated')}</TableHead>
                        <TableHead title={t('person_days')}>{t('col_effort')}</TableHead>
                        <TableHead title={t('person_days')}>{t('col_remaining')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.by_group.map((g) => (
                        <TableRow key={g.group}>
                          <TableCell>{g.group}</TableCell>
                          <TableCell className={styles.num}>{g.total}</TableCell>
                          <TableCell className={styles.num}>{g.done || ''}</TableCell>
                          <TableCell className={styles.num}>{g.in_code}</TableCell>
                          {axes.map((l) => {
                            const avg = g.axes.find((a) => a.label === l)?.average;
                            return (
                              <TableCell key={l} className={styles.num}>
                                {avg === null || avg === undefined ? '' : `${avg}%`}
                              </TableCell>
                            );
                          })}
                          <TableCell className={styles.num}>{t('estimated_of', { n: g.estimated, total: g.total })}</TableCell>
                          <TableCell className={styles.num}>{g.effort_md ? t('days', { n: g.effort_md }) : ''}</TableCell>
                          <TableCell className={styles.num}>
                            {g.remaining_md ? t('days', { n: Math.round(g.remaining_md) }) : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}
              <div className={styles.grid}>
                <section>
                  <h3 className={styles.h3}>{t('by_stage')}</h3>
                  <Table className={styles.small}>
                    <TableBody>
                      {s.by_stage.map((c) => (
                        <TableRow key={c.label}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell className={styles.num}>{c.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
                <section>
                  <h3 className={styles.h3}>{t('by_plan')}</h3>
                  <Table className={styles.small}>
                    <TableBody>
                      {s.by_plan.map((c) => (
                        <TableRow key={c.label}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell className={styles.num}>{c.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
                <section>
                  <h3 className={styles.h3}>{t('by_milestone')}</h3>
                  <Table className={styles.small}>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead>{t('col_due')}</TableHead>
                        <TableHead>{t('col_all')}</TableHead>
                        <TableHead>{t('col_committed')}</TableHead>
                        <TableHead>{t('col_at_risk')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.by_milestone.map((m) => (
                        <TableRow key={m.milestone}>
                          <TableCell>{m.milestone}</TableCell>
                          <TableCell className={styles.date}>{m.due ?? ''}</TableCell>
                          <TableCell className={styles.num}>{m.total}</TableCell>
                          <TableCell className={styles.num}>{m.committed || ''}</TableCell>
                          <TableCell className={styles.num}>{m.at_risk || ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
                {s.by_consumer.length > 0 && (
                  <section>
                    <h3 className={styles.h3}>{t('by_consumer')}</h3>
                    <Table className={styles.small}>
                      <TableHeader>
                        <TableRow>
                          <TableHead />
                          <TableHead>P1</TableHead>
                          <TableHead>P2</TableHead>
                          <TableHead>P3</TableHead>
                          <TableHead title={t('col_p1_off_track_hint')}>{t('col_p1_off_track')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.by_consumer.map((c) => (
                          <TableRow key={c.consumer}>
                            <TableCell>{c.consumer}</TableCell>
                            <TableCell className={styles.num}>{c.p1 || ''}</TableCell>
                            <TableCell className={styles.num}>{c.p2 || ''}</TableCell>
                            <TableCell className={styles.num}>{c.p3 || ''}</TableCell>
                            <TableCell className={styles.num}>{c.p1_not_on_track || ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </section>
                )}
              </div>
              {s.overdue.length > 0 && (
                <div>
                  <StatusChip tone="danger" data-roadmap-overdue>
                    {t('overdue', { milestones: s.overdue.join(', ') })}
                  </StatusChip>
                </div>
              )}
              <div className={styles.scroll}>
                <Table className={styles.small} data-roadmap-rows>
                  <TableHeader>
                    <TableRow>
                      {(['col_gear', 'col_stage', 'col_milestone', 'col_plan', 'col_demand', 'col_assignees', 'col_effort', 'col_grade'] as const).map(
                        (h) => (
                          <TableHead key={h}>{t(h)}</TableHead>
                        )
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.items.map((row) => {
                      const r = row.readiness;
                      return (
                        <TableRow key={`${row.number ?? ''}:${row.title}`} data-roadmap-row={row.title}>
                          <TableCell className={styles.top}>
                            {r.roadmap_item ? (
                              <a href={r.roadmap_item} target="_blank" rel="noreferrer" title={row.roadmap_title ?? ''}>
                                {row.title}
                              </a>
                            ) : (
                              row.title
                            )}
                            <div className={styles.sub}>{row.components.length ? row.components.join(', ') : t('not_in_code')}</div>
                          </TableCell>
                          <TableCell className={styles.top}>{r.stage ?? ''}</TableCell>
                          <TableCell className={`${styles.top} ${styles.date}`}>
                            {r.milestone ?? ''}
                            {r.due && <span className={styles.mutedInline}> · {r.due}</span>}
                            {r.committed && ` · ${t('committed')}`}
                          </TableCell>
                          <TableCell className={styles.top} title={r.plan_reasons.join('\n')}>
                            {r.plan && <StatusChip tone={LAMP[r.plan_lamp ?? ''] ?? 'neutral'}>{r.plan}</StatusChip>}
                            {r.plan_reasons.length > 0 && <div className={styles.mutedInline}>{r.plan_reasons.join('; ')}</div>}
                          </TableCell>
                          <TableCell className={styles.top}>{demandText(r.demand)}</TableCell>
                          <TableCell className={styles.top}>{row.assignees ?? ''}</TableCell>
                          <TableCell className={`${styles.top} ${styles.num}`}>
                            {row.effort_md === null ? '' : t('days', { n: row.effort_md })}
                            {row.remaining_md !== null && row.remaining_md !== row.effort_md && (
                              <div className={styles.sub}>{t('days_left', { n: Math.round(row.remaining_md) })}</div>
                            )}
                          </TableCell>
                          <TableCell className={styles.top}>{r.grade ?? ''}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

RoadmapReportBody.displayName = 'RoadmapReportBody';
