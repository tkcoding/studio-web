/**
 * Project › Activity, the prototype's `activity-view.tsx`: a header (what is
 * kept is its "about" line; how many comments and checks are its chips), the
 * kinds as a segmented choice — Comments first when there are any, since a
 * check is a machine's and a comment a person's — and the table of Event /
 * Document / By / Recorded. A run of the same check one after another (a
 * sync that checked every document) is one row, "220 documents", which opens
 * to its events.
 *
 * The By column writes the detector that made a check — `leak`, `purpose`,
 * `bloat` — where the product writes "Studio". One read
 * (`GET /studio-artifact-ingest/v1/activity`): the ordering, the naming and
 * the two kinds are the gear's (`artifact_ingest/activity.rs`). It needs no
 * other kit: nothing here is project-lifecycle's.
 *
 * The search, the kind and the sort live in the address (`act.`), as the
 * prototype's lists did (the shared list state).
 */

import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
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
import { applyClient, errorMessage, refusalText, useListState, type ScreenText } from '@constructor-studio/mfe-shared';
import { ActivityApiService } from '../../api/ActivityApiService';
import type { ActivityEvent } from '../../api/types';
import {
  KIND_CHOICES,
  RUN_SHOWN,
  countOf,
  recordedAt,
  rowsFor,
  searchText,
  shownKind,
  type ActivityRow,
} from '../../model/activity';
import styles from '../Screen.module.css';

const errText = (e: unknown) => refusalText(e) ?? errorMessage(e);

/** "3 h ago", in the screen's language; the full instant is on hover. */
export function relTime(iso: string | null | undefined, language: string, now = Date.now()): string {
  const at = Date.parse(iso ?? '');
  if (Number.isNaN(at)) return '—';
  const seconds = Math.round((at - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return new Date(at).toLocaleDateString(language);
}

function When({ iso, language }: { iso: string | null | undefined; language: string }) {
  const at = Date.parse(iso ?? '');
  return (
    <span className={styles.sub} title={Number.isNaN(at) ? undefined : new Date(at).toLocaleString(language)}>
      {relTime(iso, language)}
    </span>
  );
}

const COMPARATORS = {
  recorded: (a: ActivityRow, b: ActivityRow) => recordedAt(a) - recordedAt(b),
};

export const ActivityScreen: React.FC<{ projectId: string; t: ScreenText; language: string }> = ({
  projectId,
  t,
  language,
}) => {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The collapsed runs opened to their events. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [list, controls] = useListState('act.');

  // Bumped by Try again: the same read, once more.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    apiRegistry
      .getService(ActivityApiService)
      .activity({ projectId })
      .fetch({ staleTime: 0 })
      .then((feed) => {
        if (!alive) return;
        setError(null);
        setEvents(feed.items ?? []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(errText(e));
        setEvents([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, attempt]);

  const kind = shownKind(list.filters.kind, events ?? []);
  const rows = useMemo(() => rowsFor(events ?? [], kind), [events, kind]);
  const { matched } = useMemo(
    () => applyClient(rows, list, { searchText, comparators: COMPARATORS }),
    [rows, list]
  );

  const toggle = (id: string) =>
    setOpened((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortMark = list.sort?.key === 'recorded' ? (list.sort.dir === 'asc' ? ' ▴' : ' ▾') : '';

  return (
    <>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('activity_title')}</h2>
        {events && !error && (
          <div className={styles.chips}>
            <Badge variant="secondary" data-activity-count="comment">
              {t.count('comments', countOf(events, 'comment'))}
            </Badge>
            <Badge variant="secondary" data-activity-count="check">
              {t.count('checks', countOf(events, 'check'))}
            </Badge>
          </div>
        )}
      </header>
      <p className={styles.about}>{t('activity_about')}</p>

      {error && (
        <div className={styles.toolbar} role="alert">
          <p className={styles.error}>{t('activity_failed', { error })}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      )}

      <div className={styles.toolbar}>
        <Input
          className={styles.search}
          type="search"
          value={list.q}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(e) => controls.setQ(e.target.value)}
        />
        <div className={styles.kinds} role="tablist" aria-label={t('which_events')} data-activity-kind>
          {KIND_CHOICES.map((k) => (
            <Button
              key={k}
              role="tab"
              size="sm"
              aria-selected={kind === k}
              variant={kind === k ? 'secondary' : 'ghost'}
              onClick={() => controls.setFilter('kind', k)}
            >
              {k !== 'all' && events
                ? t('kind_with_count', { label: t(`kind_${k}`), count: countOf(events, k) })
                : t(`kind_${k}`)}
            </Button>
          ))}
        </div>
      </div>

      {events === null ? (
        <p className={styles.muted}>…</p>
      ) : rows.length === 0 && !error ? (
        <div data-activity-empty>
          <p>
            <strong>{t('empty_title')}</strong>
          </p>
          <p className={styles.muted}>{t('empty_body')}</p>
        </div>
      ) : matched.length === 0 && rows.length > 0 ? (
        <p className={styles.muted}>{t('no_matches')}</p>
      ) : matched.length > 0 ? (
        <Table data-activity-table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_event')}</TableHead>
              <TableHead>{t('col_document')}</TableHead>
              <TableHead>{t('col_by')}</TableHead>
              <TableHead aria-sort={list.sort?.key === 'recorded' ? (list.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                  type="button"
                  className={styles.sortButton}
                  title={t('sort_by', { column: t('col_recorded') })}
                  onClick={() => controls.toggleSort('recorded')}
                >
                  {t('col_recorded')}
                  {sortMark}
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matched.map((e) => (
              <Fragment key={e.id}>
                <TableRow data-activity-row={e.id}>
                  <TableCell>
                    {e.event}
                    {e.items && (
                      <Badge
                        variant="outline"
                        className={styles.runToggle}
                        role="button"
                        tabIndex={0}
                        aria-expanded={opened.has(e.id)}
                        title={opened.has(e.id) ? t('run_fold') : t('run_open')}
                        onClick={() => toggle(e.id)}
                        onKeyDown={(k: React.KeyboardEvent) => {
                          if (k.key === 'Enter' || k.key === ' ') {
                            k.preventDefault();
                            toggle(e.id);
                          }
                        }}
                        data-activity-run-toggle
                      >
                        ×{e.items.length} {opened.has(e.id) ? '▴' : '▾'}
                      </Badge>
                    )}
                    {e.severity === 'high' && (
                      <Badge variant="danger" className={styles.runToggle}>
                        {e.severity}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{e.items ? t.count('run_documents', e.items.length) : e.subject}</TableCell>
                  <TableCell>
                    <span className={styles.sub}>{e.by}</span>
                  </TableCell>
                  <TableCell>
                    <When iso={e.recorded} language={language} />
                  </TableCell>
                </TableRow>
                {e.items && opened.has(e.id) && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <ul className={styles.runList} data-activity-run>
                        {e.items.slice(0, RUN_SHOWN).map((i) => (
                          <li key={i.id}>
                            <b>{i.subject}</b> <span className={styles.sub}>{i.by}</span>{' '}
                            <When iso={i.recorded} language={language} />
                          </li>
                        ))}
                        {e.items.length > RUN_SHOWN && (
                          <li className={styles.sub}>{t('run_more', { count: e.items.length - RUN_SHOWN })}</li>
                        )}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </>
  );
};

ActivityScreen.displayName = 'ActivityScreen';
