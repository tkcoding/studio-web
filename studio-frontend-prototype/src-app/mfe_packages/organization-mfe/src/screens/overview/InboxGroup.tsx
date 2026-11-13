/**
 * "For you": the person's Inbox, the first half of the organization overview's
 * Needs attention — where the prototype had it (`waiting-on-me-view.tsx`
 * `WaitingOnYou`). What somebody waits on the reader for across the workspaces
 * they can see: the reviews somebody asked them for, and the open pull
 * requests whose next move is theirs. A row is one sentence and one action.
 *
 * The list is the server's (`GET /studio-user/v1/me/inbox`): it reads every
 * source as the caller, applies their marks and orders it, overdue first. This
 * screen only draws it and writes the marks (`PUT /me/inbox-marks`) — done, or
 * snoozed for a day, which follow the person to any browser. A review event
 * reads it again (studio-events, `review_request`). A source the server could
 * not read is named, never shown as nothing waiting.
 *
 * The same list is the Inbox screen (`screens/inbox/InboxScreen.tsx`, opened
 * from the top bar): there it is filtered by source (`only`) and read again on
 * the screen's Refresh (`reloadKey`). An item a kit brings opens only where
 * that kit is installed (`useScreenAvailability`): from an uninstalled kit it
 * keeps its title, its kit's name and Done/Snooze, never a button to a tab
 * that is not there.
 *
 * Distinct from the header's bell (`src-app/app/layout/WorkInbox.tsx`): that
 * one lists background runs the person started that have finished; this one
 * lists what other people wait on them for.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRegistry, useMfeBridge } from '@gears-frontx/react';
import { Badge, Button } from '@gears-frontx/ui-kit';
import {
  errorMessage,
  responseStatus,
  useScreenAvailability,
  useStudioEventRefresh,
} from '@constructor-studio/mfe-shared';
import { InboxApiService } from '../../api/InboxApiService';
import { requestWorkspace } from '../../actions/workspaceActions';
import {
  MY_LABEL,
  WAITING_SENTENCE,
  WAITING_TONE,
  ageLine,
  isQuiet,
  myEmptyMessage,
  prRef,
} from '../../inbox/pull-request-waits';
import { badgeVariant, inboxSources, pullOf, reviewOf, snoozeUntil, type InboxSourceCount } from '../../inbox/model';
import type { Inbox, InboxItem, InboxMarkState } from '../../inbox/types';
import type { useOverviewTranslations } from '../../i18n';
import styles from './OverviewScreen.module.css';

type Text = ReturnType<typeof useOverviewTranslations>['t'];

/** One page of the Inbox: the most the server answers at once. */
export const INBOX_PAGE = 200;

const isReviewEvent = (event: { subject_type: string }) => event.subject_type === 'review_request';

export function InboxGroup({
  organizationId,
  workspaces,
  t,
  onCount,
  only = null,
  reloadKey = 0,
  onSources,
  onFailed,
  heading = true,
  onOpenInbox,
}: {
  organizationId: string;
  /** How many workspaces the reader is in: what an empty Inbox says depends on it. */
  workspaces: number;
  t: Text;
  /** How many items are open, once read (null until then). */
  onCount?: (n: number | null) => void;
  /** Only the items of this source (`InboxItem.source`); all when absent. */
  only?: string | null;
  /** Changed by the screen to read again (its Refresh, its timer). */
  reloadKey?: number;
  /** The sources the open items come from, with their counts, once read. */
  onSources?: (sources: InboxSourceCount[]) => void;
  /** Whether the last read failed: the count is then not "nothing waits". */
  onFailed?: (failed: boolean) => void;
  /** Draw the "For you" heading (the Overview's group); the Inbox screen has its own. */
  heading?: boolean;
  /** Where the whole Inbox opens, offered beside the heading. */
  onOpenInbox?: () => void;
}) {
  const bridge = useMfeBridge();
  const api = apiRegistry.getService(InboxApiService);
  const availability = useScreenAvailability();
  const [open, setOpen] = useState<Inbox | null>(null);
  const [failed, setFailed] = useState<{ status: number | undefined; message: string } | null>(null);
  const [hidden, setHidden] = useState<Inbox | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [tick, setTick] = useState(0);
  const [more, setMore] = useState(false);

  const again = useCallback(() => setTick((n) => n + 1), []);
  useStudioEventRefresh(isReviewEvent, again);

  const shown = useCallback(
    (next: Inbox) => {
      setOpen(next);
      onCount?.(next.total);
      onSources?.(inboxSources(next.items));
    },
    [onCount, onSources]
  );

  useEffect(() => {
    let live = true;
    api
      .inbox({ view: 'open', offset: 0, limit: INBOX_PAGE })
      .fetch({ staleTime: 0 })
      .then((page) => {
        if (!live) return;
        setFailed(null);
        onFailed?.(false);
        shown(page);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setFailed({ status: responseStatus(e), message: errorMessage(e) });
        onFailed?.(true);
        onCount?.(0);
      });
    return () => {
      live = false;
    };
  }, [api, tick, reloadKey, shown, onCount, onFailed]);

  useEffect(() => {
    if (!showHidden) return;
    let live = true;
    api
      .inbox({ view: 'hidden', offset: 0, limit: INBOX_PAGE })
      .fetch({ staleTime: 0 })
      .then((page) => live && setHidden(page))
      .catch((e: unknown) => live && setHidden({ items: [], total: 0, other: 0, unread: [errorMessage(e)] }));
    return () => {
      live = false;
    };
  }, [api, showHidden, tick, reloadKey]);

  /** The next page of open items, after the ones shown. */
  const readMore = async () => {
    if (!open) return;
    setMore(true);
    try {
      const page = await api
        .inbox({ view: 'open', offset: open.items.length, limit: INBOX_PAGE })
        .fetch({ staleTime: 0 });
      shown({ ...page, items: [...open.items, ...page.items] });
    } catch {
      again();
    } finally {
      setMore(false);
    }
  };

  const mark = async (item: InboxItem, state: InboxMarkState) => {
    const until = state === 'snoozed' ? snoozeUntil(new Date(), 1) : null;
    // Shown at once; the server's next answer replaces it.
    if (state === 'open') {
      setHidden((h) => h && { ...h, items: h.items.filter((i) => i.key !== item.key), total: Math.max(0, h.total - 1) });
    } else if (open) {
      shown({
        ...open,
        items: open.items.filter((i) => i.key !== item.key),
        total: Math.max(0, open.total - 1),
        other: open.other + 1,
      });
    }
    try {
      await api.mark.fetch({ item_key: item.key, state, until });
    } finally {
      // An unmarked item comes back in the server's order. A failed mark is
      // read again by the caller, so the item shows as it really is.
      if (state === 'open') again();
    }
  };

  // "Unmark all": the hidden items' marks only, every request awaited; the
  // Inbox is read again either way, so a failed one shows as still hidden (#744).
  const unmarkAll = async () => {
    const keys = (hidden?.items ?? []).map((i) => i.key);
    await Promise.allSettled(keys.map((key) => api.mark.fetch({ item_key: key, state: 'open', until: null })));
    setShowHidden(false);
    setHidden(null);
    again();
  };

  const markOrReread = (item: InboxItem, state: InboxMarkState) => {
    mark(item, state).catch(again);
  };

  const hiddenCount = open?.other ?? 0;
  const rows = (open ? [...open.items, ...(showHidden ? (hidden?.items ?? []) : [])] : []).filter(
    (item) => !only || item.source === only
  );
  const unread = [...(open?.unread ?? []), ...(showHidden ? (hidden?.unread ?? []) : [])];

  return (
    <div data-attention-group="you" className={styles.youGroup}>
      {heading && (
        <h3 className={styles.group}>
          {t('for_you')}
          {open && open.total > 0 && <span className={styles.count}>{open.total}</span>}
          {onOpenInbox && (
            <button type="button" className={styles.linklike} data-open-inbox onClick={onOpenInbox}>
              {t('inbox_open_all')}
            </button>
          )}
        </h3>
      )}
      {failed ? (
        <p role="alert" className={styles.error} data-inbox-error={failed.status ?? 'network'}>
          {failed.status === 503
            ? t('inbox_unavailable', { error: failed.message })
            : t('inbox_failed', { error: failed.message })}
        </p>
      ) : !open ? (
        <p className={styles.muted}>{t('inbox_reading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted} data-inbox-empty>
          {unread.length > 0
            ? t('inbox_nothing_read', { sources: unread.join('; ') })
            : hiddenCount > 0
              ? t.count('inbox_nothing_new', hiddenCount)
              : (
                <>
                  {t('inbox_nothing')}{' '}
                  <span title={t('inbox_why')}>{myEmptyMessage({ membersKnown: true, workspaces })}</span>
                </>
              )}
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((item) => {
            const isHidden = !open.items.includes(item);
            return (
              <InboxRow
                key={item.key}
                item={item}
                isHidden={isHidden}
                kitHere={!item.kit || availability.kit(item.kit.slug)}
                t={t}
                onOpenWorkspace={() =>
                  requestWorkspace(bridge, { id: item.workspace_id, name: item.workspace_name }, organizationId)
                }
                onMark={(state) => markOrReread(item, state)}
              />
            );
          })}
        </ul>
      )}
      {open && open.total > open.items.length && (
        <p className={styles.muted}>
          {t('inbox_more', { shown: open.items.length, total: open.total })}{' '}
          <button type="button" className={styles.linklike} disabled={more} onClick={() => void readMore()}>
            {t('inbox_show_more')}
          </button>
        </p>
      )}
      {open && hiddenCount > 0 && (
        <p className={styles.muted} data-inbox-hidden>
          {t.count('inbox_hidden', hiddenCount)}{' '}
          <button type="button" className={styles.linklike} onClick={() => setShowHidden((s) => !s)}>
            {showHidden ? t('inbox_hide_them') : t('inbox_show_them')}
          </button>
          {showHidden && hidden && hidden.items.length > 0 && (
            <button type="button" className={styles.linklike} onClick={() => void unmarkAll()}>
              {t('inbox_unmark_all')}
            </button>
          )}
        </p>
      )}
      {rows.length > 0 && unread.length > 0 && (
        <p className={styles.muted} data-inbox-unread>
          {t('inbox_unread', { sources: unread.join('; ') })}
        </p>
      )}
    </div>
  );
}

function InboxRow({
  item,
  isHidden,
  kitHere,
  t,
  onOpenWorkspace,
  onMark,
}: {
  item: InboxItem;
  isHidden: boolean;
  /** Whether the kit the item comes from is installed where the person is. */
  kitHere: boolean;
  t: Text;
  onOpenWorkspace: () => void;
  onMark: (state: InboxMarkState) => void;
}) {
  const review = reviewOf(item);
  const pull = pullOf(item);
  return (
    <li
      className={`${styles.row} ${styles.inboxRow} ${item.overdue ? styles.warn : styles.info}`}
      data-attention={review ? 'review' : pull ? 'pull' : item.source}
      data-hidden-item={isHidden || undefined}
    >
      <span className={styles.inboxText}>
        {review ? (
          <>
            {t('inbox_review')} <b>{item.title || review.title}</b>
            <span className={styles.muted}>
              {' · '}
              {t('inbox_asked', { who: review.requested_by_name || t('inbox_colleague'), workspace: item.workspace_name })}
              {item.due_at && <> · {t('inbox_due', { date: item.due_at.slice(0, 10) })}</>}
            </span>{' '}
            {item.overdue && <Badge variant="warning">{t('inbox_overdue')}</Badge>}
          </>
        ) : pull ? (
          <>
            <b>{item.title || pull.title}</b>
            <span className={styles.muted}>
              {' · '}
              {prRef(pull)}, {item.workspace_name} · {ageLine(pull)}
            </span>{' '}
            <Badge variant={badgeVariant(WAITING_TONE[pull.waiting])} title={WAITING_SENTENCE[pull.waiting]}>
              {MY_LABEL[pull.waiting]}
            </Badge>{' '}
            {isQuiet(pull) && <Badge variant="warning">{t('inbox_quiet')}</Badge>}
          </>
        ) : (
          <>
            <b>{item.title}</b>
            {item.workspace_name && <span className={styles.muted}> · {item.workspace_name}</span>}{' '}
            {item.kit && (
              <Badge
                variant="secondary"
                title={kitHere ? t('inbox_from_kit_title') : t('inbox_kit_absent_title')}
                data-inbox-kit={item.kit.slug}
                data-kit-absent={kitHere ? undefined : true}
              >
                {item.kit.name}
              </Badge>
            )}
          </>
        )}
      </span>
      <span className={styles.inboxActions}>
        {/* Where an item leads: its own page, else its workspace — never a
            tab of a kit that is not installed here, nor a workspace it does
            not name. */}
        {!kitHere ? null : item.url ? (
          <a className={styles.action} href={item.url} target="_blank" rel="noreferrer">
            {pull ? t('inbox_open_pull') : t('inbox_open')}
          </a>
        ) : item.workspace_id ? (
          <button type="button" className={styles.action} onClick={onOpenWorkspace}>
            {t('inbox_open_project')}
          </button>
        ) : null}
        {isHidden ? (
          <Button variant="ghost" size="sm" title={t('inbox_unmark_title')} onClick={() => onMark('open')}>
            {t('inbox_unmark')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" title={t('inbox_done_title')} onClick={() => onMark('done')}>
              {t('inbox_done')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMark('snoozed')}>
              {t('inbox_snooze')}
            </Button>
          </>
        )}
      </span>
    </li>
  );
}
