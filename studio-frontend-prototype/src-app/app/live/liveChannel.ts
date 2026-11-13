/**
 * The shell's live channel: ONE `studio-events` subscription for the signed-in
 * person, handed to everything that listens (docs/studio-events.md, "The
 * shell's channel").
 *
 * The prototype's `studio-events.ts` learned it the hard way: a stream per
 * widget (the run list, the inbox, the bell, the live domain changes …) took
 * all six of the browser's HTTP/1.1 connections to the host, and every other
 * request of the page queued behind them. So the shell holds the connection
 * and fans it out twice:
 *
 * - to the shell's own listeners ({@link LiveChannel.subscribe}) — the bell;
 * - across the realm boundary, as the shared property
 *   `STUDIO_SHARED_PROPERTY_LIVE_EVENT` — every micro-frontend that declares
 *   it, read with mfe-shared's `useStudioEventRefresh`.
 *
 * Auth, reconnect and the gap replay are the transport's (`SseAuthPlugin` in
 * `StudioEventsApiService`); this module dedupes by `seq`, since a replayed
 * page and the live stream can overlap, and counts its users so the stream is
 * open exactly while somebody signed in is on the page.
 *
 * The stream follows the organization on screen ({@link LiveChannel.setScope},
 * `?organization_id=`), not only the person's home tenant: a platform
 * administrator looking at an organization, or a member of several, hears the
 * runs and changes of the one they are looking at (the prototype's live domain
 * changes did the same). A new scope closes the old stream and opens the new
 * one; `seq` is per tenant, so the cursor starts over and the micro-frontends
 * are told with a `null` that whatever they last heard is not this tenant's.
 */

import { apiRegistry, type FrontXApp } from '@gears-frontx/react';
import { StudioEventsApiService, type StudioEvent } from '@constructor-studio/mfe-shared';
import { publishLiveEvent } from '@/app/mfe/sharedContext';

/** The part of an SSE stream descriptor the channel uses. */
export interface LiveStream {
  connect(onEvent: (event: StudioEvent) => void, onComplete?: () => void): Promise<string>;
  disconnect(connectionId: string): void;
}

export type LiveStatus = 'idle' | 'open' | 'closed';

export type LiveListener = (event: StudioEvent) => void;

export interface LiveChannel {
  /** Opens the stream for the first user; the returned release closes it after the last. */
  start(): () => void;
  /**
   * The organization to listen to (`null`: the person's home tenant). Taking
   * effect at once while the stream is open, else at the next start.
   */
  setScope(organizationId: string | null): void;
  /** The organization listened to, `null` for the home tenant. */
  scope(): string | null;
  /** Hears every new event while the stream is open. */
  subscribe(listener: LiveListener): () => void;
  status(): LiveStatus;
}

export interface LiveChannelDeps {
  /** The stream of one organization's tenant, or of the home tenant for `null`. */
  stream: (organizationId: string | null) => LiveStream;
  /** Relays one event to the micro-frontends. */
  publish: (event: StudioEvent | null) => void;
  warn?: (message: string, error?: unknown) => void;
}

export function createLiveChannel({ stream, publish, warn = console.warn }: LiveChannelDeps): LiveChannel {
  const listeners = new Set<LiveListener>();
  let users = 0;
  let lastSeq = 0;
  let state: LiveStatus = 'idle';
  let open: { stream: LiveStream; id: Promise<string> } | null = null;
  let organization: string | null = null;

  const deliver = (event: StudioEvent): void => {
    if (typeof event?.seq !== 'number' || event.seq <= lastSeq) return;
    lastSeq = event.seq;
    publish(event);
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        warn('[live] a listener failed', error);
      }
    }
  };

  const connect = (): void => {
    let descriptor: LiveStream;
    try {
      descriptor = stream(organization);
    } catch (error) {
      // No events service (a test app, a host without it): the screens keep
      // their own floor — a slow reload — and nothing breaks.
      warn('[live] the studio-events stream is not available', error);
      state = 'closed';
      return;
    }
    state = 'open';
    const current = {
      stream: descriptor,
      id: descriptor.connect(deliver, () => {
        // Refused (401/403) or ended for good: the transport already retried
        // what a retry could fix. Polling floors take over until a new start.
        if (open === current) state = 'closed';
      }),
    };
    open = current;
    current.id.catch((error: unknown) => {
      if (open !== current) return;
      state = 'closed';
      warn('[live] the studio-events stream did not open', error);
    });
  };

  const disconnect = (): void => {
    const closing = open;
    open = null;
    state = 'idle';
    // A new person (or the same one, later), or another organization, starts
    // over: that tenant's cursor owes nothing to this one's.
    lastSeq = 0;
    if (closing) void closing.id.then((id) => closing.stream.disconnect(id), () => undefined);
  };

  return {
    start() {
      users += 1;
      if (users === 1) connect();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        users -= 1;
        if (users === 0) disconnect();
      };
    },
    setScope(organizationId) {
      const next = organizationId || null;
      if (next === organization) return;
      organization = next;
      if (users === 0) return;
      disconnect();
      // The screens' last event was another tenant's: its seq says nothing here.
      publish(null);
      connect();
    },
    scope: () => organization,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status: () => state,
  };
}

let shellChannel: LiveChannel | null = null;

/** Creates the shell's channel; `main.tsx` calls it once, after the events service is registered. */
export function registerLiveChannel(app: FrontXApp): LiveChannel {
  shellChannel = createLiveChannel({
    stream: (organizationId) => apiRegistry.getService(StudioEventsApiService).eventsFor(organizationId),
    publish: (event) => publishLiveEvent(app, event),
  });
  return shellChannel;
}

/** The shell's channel, or `null` where none was registered (most unit tests). */
export function liveChannel(): LiveChannel | null {
  return shellChannel;
}
