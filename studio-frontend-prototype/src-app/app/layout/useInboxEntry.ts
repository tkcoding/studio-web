/**
 * The top bar's way into the Inbox (the prototype's `InboxButton`,
 * `inbox-view.tsx`): the Inbox screen (organization-mfe, route `/inbox`) and
 * how many items wait on the person. The count is read when the button
 * appears, every two minutes, and when a review moves (studio-events,
 * `review_request`), as the prototype did — and when the person moves to
 * another screen, so a mark made on the Inbox shows here at once (leaving the
 * Inbox or an Overview, or with a count older than {@link INBOX_FRESH_MS}; a
 * click between two other tabs asks nothing); `null` while
 * unknown or unreadable, so a failed read never shows as "nothing waits".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRegistry, eventBus, useAppSelector, useDomainExtensions, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import type { StudioEvent } from '@constructor-studio/mfe-shared';
import { InboxCountApiService } from '@/app/api/InboxCountApiService';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { useStudioEvents } from '@/app/live/useLiveChannel';

/** The route the Inbox screen answers to. */
export const INBOX_ROUTE = '/inbox';

/** How often the count is read again without an event. */
export const INBOX_REREAD_MS = 120_000;

/** How old a count may be before a move to another screen reads it again. */
export const INBOX_FRESH_MS = 15_000;

/** The sections where the person marks Inbox items: leaving one reads the count again at once. */
export const MARKS_INBOX: ReadonlySet<string> = new Set(['inbox', 'overview']);

/** Whether an event may change what waits on the person. */
export function movesInbox(event: StudioEvent): boolean {
  return event.subject_type === 'review_request';
}

export interface InboxEntry {
  /** The Inbox screen, when one is registered. */
  screen: StudioScreenExtension | undefined;
  /** How many items wait, or `null` while unknown. */
  count: number | null;
  open: () => void;
}

export function useInboxEntry(): InboxEntry {
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const screen = screens.find((s) => s.presentation?.route === INBOX_ROUTE);
  const screenId = screen?.id ?? null;
  const [count, setCount] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const section = useAppSelector(
    (state) => (state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined)?.section ?? null
  );
  const again = useCallback(() => setTick((n) => n + 1), []);

  // When the count was last asked for, and the section the person was on.
  const readAt = useRef(0);
  const previousSection = useRef(section);

  useEffect(() => {
    if (!screenId) return;
    let live = true;
    readAt.current = Date.now();
    apiRegistry
      .getService(InboxCountApiService)
      .count.fetch({ staleTime: 0 })
      .then((answer) => live && setCount(typeof answer?.total === 'number' ? answer.total : null))
      .catch(() => live && setCount(null));
    return () => {
      live = false;
    };
  }, [screenId, tick]);

  // A move to another screen reads again only when it can have changed the
  // count: leaving a screen where items are marked, or a count old enough to
  // be worth asking about. The server reads every source to answer, and every
  // tab click used to cost one.
  useEffect(() => {
    const left = previousSection.current;
    previousSection.current = section;
    if (left === section) return;
    if ((left !== null && MARKS_INBOX.has(left)) || Date.now() - readAt.current >= INBOX_FRESH_MS) again();
  }, [section, again]);

  useEffect(() => {
    if (!screenId) return;
    const timer = setInterval(again, INBOX_REREAD_MS);
    return () => clearInterval(timer);
  }, [screenId, again]);

  useStudioEvents(
    useCallback(
      (event: StudioEvent) => {
        if (movesInbox(event)) again();
      },
      [again]
    )
  );

  const open = useCallback(() => {
    if (screenId) eventBus.emit('app/context/screen/requested', { extensionId: screenId });
  }, [screenId]);

  return { screen, count, open };
}
