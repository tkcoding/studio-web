/**
 * The shell's live channel, read from inside a micro-frontend.
 *
 * The shell holds ONE `studio-events` subscription for the signed-in person
 * and relays every frame through the shared property
 * `STUDIO_SHARED_PROPERTY_LIVE_EVENT` (docs/studio-events.md, "The shell's
 * channel"). A screen that only needs "something changed, read again" uses
 * {@link useStudioEventRefresh} instead of opening a stream of its own: one
 * connection per tab, however many screens listen — the prototype learned
 * that a stream per widget took all six of the browser's connections.
 *
 * Declare the property in the entry's `requiredProperties` to read it.
 */

import { useEffect, useRef } from 'react';
import { useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import { STUDIO_SHARED_PROPERTY_LIVE_EVENT } from '../host/hostProperties';
import type { StudioEvent, StudioRunEvent } from './StudioEventsApiService';

/** How long a burst of events is gathered into one refresh. */
export const LIVE_REFRESH_DELAY_MS = 300;

/** Whether a value is an event as the channel carries it. */
export function isStudioEvent(value: unknown): value is StudioEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<StudioEvent>;
  return (
    typeof event.seq === 'number' &&
    typeof event.kind === 'string' &&
    typeof event.subject_type === 'string' &&
    typeof event.subject_id === 'string'
  );
}

/** Whether an event is a transition of a `studio-tasks` run. */
export function isRunEvent(event: StudioEvent): event is StudioEvent<StudioRunEvent> {
  return event.subject_type === 'task_run';
}

/**
 * Whether an event is a run's ending — succeeded, failed or cancelled: what
 * changes a status a screen shows (a sync that read the sources, a build),
 * where a run's every progress report would only make the screen read again
 * for nothing.
 */
export function isRunEnding(event: StudioEvent): event is StudioEvent<StudioRunEvent> {
  if (!isRunEvent(event)) return false;
  const state = (event.payload as Partial<StudioRunEvent> | null)?.state;
  return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

/**
 * A matcher for domain changes (ADR-0066, the prototype's `useDomainRefresh`):
 * objects of one of `types` were written, deleted or related
 * (`domain.objects_changed`), or — with `model` — the model itself changed
 * (`domain.model_changed`). Events are prompts, not data: read again.
 */
export function domainChanged(
  types: readonly string[],
  { model = false }: { model?: boolean } = {}
): (event: StudioEvent) => boolean {
  return (event) => {
    if (event.kind === 'domain.model_changed') return model;
    if (event.kind !== 'domain.objects_changed') return false;
    const entity = (event.payload as { entity?: string } | null)?.entity ?? event.subject_id;
    return types.includes(entity);
  };
}

/** The newest event the shell relayed, or `null` before the first one (or outside the shell). */
export function useLiveStudioEvent(options?: { bridge?: ChildMfeBridge }): StudioEvent | null {
  const value = useSharedProperty<unknown>(STUDIO_SHARED_PROPERTY_LIVE_EVENT, options);
  return isStudioEvent(value) ? value : null;
}

/**
 * Calls `refresh` after an event `matches` arrives — a burst gathered into one
 * call, `delayMs` after its first event. The event that was already there when
 * the screen mounted is not news and refreshes nothing.
 *
 * A gathered refresh is not restarted by the events behind it: a run that
 * reports progress several times a second still refreshes the list every
 * `delayMs`, rather than never.
 */
export function useStudioEventRefresh(
  matches: (event: StudioEvent) => boolean,
  refresh: () => void,
  options: { bridge?: ChildMfeBridge; delayMs?: number } = {}
): void {
  const { bridge, delayMs = LIVE_REFRESH_DELAY_MS } = options;
  const event = useLiveStudioEvent(bridge ? { bridge } : undefined);
  // The newest seq handled; what was there at mount counts as handled.
  const handled = useRef(event?.seq ?? 0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ matches, refresh });

  useEffect(() => {
    latest.current = { matches, refresh };
  });

  useEffect(() => {
    // `null` after an event: the shell switched to another organization's
    // stream, whose seq starts over — whatever comes next is news.
    if (!event) {
      handled.current = 0;
      return;
    }
    if (event.seq <= handled.current) return;
    handled.current = event.seq;
    if (!latest.current.matches(event) || pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      latest.current.refresh();
    }, delayMs);
  }, [event, delayMs]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    },
    []
  );
}
