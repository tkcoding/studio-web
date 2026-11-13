/** One person, opened from a row or the matrix — the prototype's `PersonPanel` (`people-org.tsx`). */

import React, { useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@gears-frontx/ui-kit';
import {
  INSIGHT_DAYS,
  gitHandles,
  initials,
  insightTotals,
  personOf,
  recentFor,
  totals,
  type AccessModel,
  type OrgProject,
  type PersonProject,
  type PersonRow,
  type ScreenText,
} from '@constructor-studio/mfe-shared';
import { FEED_DAYS, type OrgActivity } from './useOrgActivity';
import { PersonPhoto } from './ProjectMarks';
import { activityWords, aliasKindLabel, fullTime, relTime } from './words';
import styles from './PeopleScreen.module.css';

const WAITING = ['review', 'author', 'merge', 'draft', 'nobody'];

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className={`${styles.kpi}${tone ? ` ${styles[tone]}` : ''}`}>
      <span className={styles.kpiValue}>{value}</span>
      <span className={styles.kpiLabel}>{label}</span>
      {sub && <span className={styles.muted}>{sub}</span>}
    </div>
  );
}

export function PersonPanel({
  person,
  describe,
  membership,
  model,
  rows,
  activity,
  lastSeenMs,
  online,
  t,
  language,
  container,
  onOpenProject,
  onClose,
}: {
  person: PersonRow;
  describe: string;
  membership: string;
  model: AccessModel;
  rows: PersonProject[];
  activity: OrgActivity;
  lastSeenMs: number | undefined;
  online: boolean;
  t: ScreenText;
  language: string;
  container: React.RefObject<HTMLDivElement | null>;
  onOpenProject: (p: OrgProject) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ident = activity.identities.get(person.id);
  const handles = gitHandles(ident?.aliases ?? []);
  const sum = totals(activity.index.get(person.id));
  const insight =
    activity.insight.state === 'ok'
      ? insightTotals(
          activity.insight.figures,
          handles.map((h) => h.handle)
        )
      : null;
  const recent = recentFor(person.id, activity.dir, activity.feeds);
  const projectName = (id: string) => rows.find((r) => r.project.id === id)?.project.name ?? id.slice(0, 8);
  const relevant = rows
    .filter((r) => r.intensity > 0 || (model === 'roles' && r.access))
    .sort((a, b) => b.intensity - a.intensity || a.project.name.localeCompare(b.project.name));
  const others = model === 'tenant' ? rows.length - relevant.length : 0;
  // Open pull requests that wait on this person's review, oldest first.
  const waiting = activity.pulls
    .flatMap((p) =>
      p.items
        .filter(
          (pr) =>
            pr.waiting === 'review' &&
            pr.waiting_on.some((w) => personOf(activity.dir, w.login, w.user_id) === person.id)
        )
        .map((pr) => ({ projectId: p.projectId, pr }))
    )
    .sort((a, b) => (b.pr.days_open ?? 0) - (a.pr.days_open ?? 0))
    .slice(0, 6);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent container={container} closeLabel={t('close')} size="lg" className={styles.panel} data-person-panel>
        <DialogHeader>
          <div className={styles.panelHead}>
            <PersonPhoto name={person.name} url={person.avatarUrl} large />
            <div className={styles.grow}>
              <DialogTitle>{person.name}</DialogTitle>
              <div className={styles.muted}>{[membership, describe].filter(Boolean).join(' · ')}</div>
              <div className={styles.chips}>
                {online ? (
                  <Badge variant="success">{t('online')}</Badge>
                ) : lastSeenMs != null ? (
                  <span className={styles.muted} title={fullTime(lastSeenMs, language)}>
                    {t('last_seen', { when: relTime(lastSeenMs, language) })}
                  </span>
                ) : (
                  <span className={styles.muted}>{t('not_seen')}</span>
                )}
                {handles.map((h) => (
                  <Badge
                    key={`${h.kind}:${h.handle}`}
                    variant={h.confirmed ? 'info' : 'secondary'}
                    title={h.confirmed ? t('handle_confirmed') : t('handle_claimed')}
                  >
                    {aliasKindLabel(h.kind, t)} · {h.handle}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </DialogHeader>

        <section className={styles.panelSec}>
          <h3>{t('contact')}</h3>
          {person.email ? (
            <div>
              <a href={`mailto:${person.email}`}>{person.email}</a>{' '}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(person.email ?? '')
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false))
                }
              >
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
          ) : (
            <span className={styles.muted}>{t('addresses_hidden')}</span>
          )}
        </section>

        <section className={styles.panelSec} data-person-projects>
          <h3>
            {t('projects_roles')}{' '}
            <span className={styles.muted}>
              {model === 'roles' ? t('model_roles') : t('panel_model_tenant', { count: rows.length })}
            </span>
          </h3>
          {relevant.length === 0 ? (
            <p className={styles.muted}>
              {activity.loading
                ? t('stack_reading')
                : model === 'roles'
                  ? t('panel_no_role')
                  : t('panel_no_activity')}
            </p>
          ) : (
            <ul className={styles.panelList}>
              {relevant.map((r) => (
                <li key={r.project.id}>
                  <button
                    type="button"
                    className={styles.panelProj}
                    onClick={() => onOpenProject(r.project)}
                    title={t('matrix_open', { project: r.project.name })}
                  >
                    <span className={styles.projMark} aria-hidden>
                      {initials(r.project.name)}
                    </span>
                    <span className={styles.grow}>
                      <strong>{r.project.name}</strong>
                      <span className={styles.muted}> · {r.project.workspaceName}</span>
                      <span className={`${styles.muted} ${styles.block}`}>
                        {activityWords(r.activity, t) || t('chip_no_activity')}
                      </span>
                    </span>
                    {r.access && (
                      <Badge variant="secondary" title={r.access.via === 'org' ? t('org_wide_title') : undefined}>
                        {r.access.roleName}
                        {r.access.via === 'org' ? ` · ${t('org_wide')}` : ''}
                      </Badge>
                    )}
                    <Badge variant={r.intensity > 0 ? 'success' : 'secondary'}>
                      {r.intensity > 0 ? t('active_in') : t('can_access')}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {others > 0 && relevant.length > 0 && <p className={styles.muted}>{t('more_access', { count: others })}</p>}
        </section>

        <section className={styles.panelSec} data-person-prs>
          <h3>{t('prs')}</h3>
          <div className={styles.kpis}>
            <Kpi label={t('kpi_authored')} value={sum.pullsAuthored} sub={t('kpi_authored_sub')} />
            <Kpi label={t('kpi_reviewing')} value={sum.pullsReviewing} sub={t('kpi_reviewing_sub')} />
            <Kpi
              label={t('kpi_load')}
              value={sum.waitingOnThem}
              sub={t('kpi_load_sub')}
              tone={sum.waitingOnThem >= 5 ? 'danger' : sum.waitingOnThem >= 2 ? 'warn' : undefined}
            />
          </div>
          {waiting.length > 0 && (
            <ul className={styles.panelList}>
              {waiting.map(({ projectId, pr }) => (
                <li key={pr.id}>
                  {pr.url ? (
                    <a href={pr.url} target="_blank" rel="noreferrer">
                      #{pr.number} {pr.title}
                    </a>
                  ) : (
                    <span>
                      #{pr.number} {pr.title}
                    </span>
                  )}{' '}
                  <span className={styles.muted}>
                    {projectName(projectId)} · {WAITING.includes(pr.waiting) ? t(`waits_${pr.waiting}`) : pr.waiting}
                    {pr.days_open != null ? ` · ${t('days_open', { count: pr.days_open })}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h4 title={t('insight_about')}>{t('insight_title', { days: INSIGHT_DAYS })}</h4>
          {handles.length === 0 ? (
            <div className={styles.empty}>
              <strong>{t('no_handle_title')}</strong>
              <span className={styles.muted}>
                {activity.identitiesReadable ? t('no_handle_body') : t('no_handle_unreadable')}
              </span>
            </div>
          ) : activity.insight.state === 'loading' ? (
            <p className={styles.muted}>{t('insight_loading')}</p>
          ) : activity.insight.state === 'failed' ? (
            <p className={styles.muted}>{t('insight_failed', { detail: activity.insight.detail })}</p>
          ) : insight ? (
            <>
              <div className={styles.kpis}>
                <Kpi label={t('kpi_prs')} value={insight.prs} />
                <Kpi label={t('kpi_merged')} value={insight.merged} />
                <Kpi label={t('kpi_reviews')} value={insight.reviews} />
              </div>
              {insight.repos.length > 0 ? (
                <ul className={styles.panelList}>
                  {insight.repos.slice(0, 6).map((r) => (
                    <li key={r.repo}>
                      <code>{r.repo}</code> <Badge variant="secondary">{t.count('insight_prs', r.prs)}</Badge>{' '}
                      <Badge variant="secondary">{t.count('insight_reviews', r.reviews)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>
                  {t('insight_nothing', { handles: handles.map((h) => h.handle).join(', ') })}
                </p>
              )}
            </>
          ) : null}
        </section>

        <section className={styles.panelSec} data-person-recent>
          <h3>{t('recent')}</h3>
          {recent.length === 0 ? (
            <p className={styles.muted}>
              {handles.length === 0 ? t('recent_no_handle') : t('recent_none', { days: FEED_DAYS })}
            </p>
          ) : (
            <ul className={styles.panelList}>
              {recent.map((e, i) => {
                const at = e.at ? Date.parse(e.at) : null;
                return (
                  <li key={i}>
                    {e.what} <strong>{e.subject}</strong>{' '}
                    <span className={styles.muted}>
                      {t('recent_in', { project: projectName(e.projectId) })} ·{' '}
                      <span title={fullTime(at, language)}>{relTime(at, language)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* The per-person metrics panels land here once the shared metrics
            module has a person scope; until then the counts above are the figures. */}
        <section className={styles.panelSec} data-person-metrics-slot>
          <h3>{t('metrics')}</h3>
          <p className={styles.muted}>{t('metrics_later')}</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
