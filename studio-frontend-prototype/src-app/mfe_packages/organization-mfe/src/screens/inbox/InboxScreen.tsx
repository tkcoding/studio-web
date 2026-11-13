/**
 * The Inbox: the person's page of everything that waits for them (the
 * prototype's `InboxView`, `inbox-view.tsx`; ADR-0068 §6), opened from the
 * top bar's Inbox button (the shell's `useInboxEntry`).
 *
 * The shell's frame around the server's list (`GET /studio-user/v1/me/inbox`):
 * a header saying how many wait, a chip per source the open items come from —
 * the shell's own and each installed kit's, by the kit's name — with its
 * count, and Refresh. The rows, the marks (Done, Snooze, Unmark, Unmark all),
 * the hidden ones, paging and the sources that could not be read are the same
 * list the Organization Overview shows under "For you" (`InboxGroup`). Read
 * again every two minutes, on Refresh, and when a review moves.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Skeleton } from '@gears-frontx/ui-kit';
import { useOrganization } from '@constructor-studio/mfe-shared';
import { InboxGroup } from '../overview/InboxGroup';
import type { InboxSourceCount } from '../../inbox/model';
import { useOverviewTranslations } from '../../i18n';
import overviewStyles from '../overview/OverviewScreen.module.css';
import styles from './InboxScreen.module.css';

type Text = ReturnType<typeof useOverviewTranslations>['t'];

/** How often the page reads the Inbox again without being asked (the prototype's). */
export const INBOX_PAGE_REREAD_MS = 120_000;

/**
 * A source's chip word: Studio's own two (review requests, pull requests) in
 * the person's language — they name their kit (project-specs, project-git,
 * ADR-0070 §7) but say what they hold, not where they come from — else its
 * kit's name.
 */
export function sourceLabel(source: InboxSourceCount, t: Text): string {
  if (source.source === 'review-requests') return t('inbox_source_reviews');
  if (source.source === 'pull-requests') return t('inbox_source_pulls');
  if (source.kit?.name) return source.kit.name;
  return source.source;
}

export const InboxScreen: React.FC = () => {
  const { org } = useOrganization();
  const { t, loading } = useOverviewTranslations();
  if (loading || !org) return <Skeleton className={overviewStyles.skeleton} />;
  return <InboxPage key={org.id} organizationId={org.id} t={t} />;
};

InboxScreen.displayName = 'InboxScreen';

function InboxPage({ organizationId, t }: { organizationId: string; t: Text }) {
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [sources, setSources] = useState<InboxSourceCount[]>([]);
  const [only, setOnly] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    const timer = setInterval(reload, INBOX_PAGE_REREAD_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // A chip whose source has nothing open any more falls back to Everything.
  const current = only && sources.some((s) => s.source === only) ? only : null;

  return (
    <div className={styles.screen} data-inbox-screen>
      <header className={styles.header}>
        <h2 className={styles.title} title={t('inbox_about')}>
          {t('inbox_title')}
        </h2>
        {failed ? (
          <Badge variant="danger">{t('inbox_status_unreadable')}</Badge>
        ) : count === null ? (
          <Badge variant="info">{t('reading')}</Badge>
        ) : (
          <Badge variant={count > 0 ? 'warning' : 'success'} dot data-inbox-status>
            {count > 0 ? t('inbox_status_waiting', { count }) : t('inbox_status_nothing')}
          </Badge>
        )}
      </header>
      <p className={styles.about}>{t('inbox_about')}</p>

      <div className={styles.toolbar}>
        <div className={styles.chips} role="group" aria-label={t('inbox_show')}>
          <button
            type="button"
            className={`${styles.chip} ${current === null ? styles.on : ''}`}
            aria-pressed={current === null}
            onClick={() => setOnly(null)}
          >
            {t('inbox_everything')}
            <span className={styles.chipCount}>{count ?? 0}</span>
          </button>
          {sources.map((s) => (
            <button
              key={s.source}
              type="button"
              className={`${styles.chip} ${current === s.source ? styles.on : ''}`}
              aria-pressed={current === s.source}
              data-inbox-source={s.source}
              onClick={() => setOnly(current === s.source ? null : s.source)}
            >
              {sourceLabel(s, t)}
              <span className={styles.chipCount}>{s.count}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={reload} data-inbox-refresh>
          {t('inbox_refresh')}
        </Button>
      </div>

      <InboxGroup
        organizationId={organizationId}
        workspaces={1}
        t={t}
        heading={false}
        only={current}
        reloadKey={reloadKey}
        onCount={setCount}
        onFailed={setFailed}
        onSources={setSources}
      />
    </div>
  );
}
