/**
 * Studio Events Domain - API Service
 *
 * The backend's push channel: one stream per tenant carrying everything the
 * assembly publishes — every `studio-tasks` run transition first among them.
 * Replaces polling `GET /studio-tasks/v1/runs/{id}` every second.
 *
 * Two surfaces, and they work together:
 *   * `events` — the live SSE stream, consumed with `useApiStream`;
 *   * `since` / `cursor` — the same events by cursor, which is how a gap is
 *     filled and how a job started before the stream opened is still seen.
 */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
  SseProtocol,
  SseStreamProtocol,
} from '@gears-frontx/react';
// TODO: the authenticated SSE transport belongs in FrontX; import it from there once it lands.
import { SseAuthPlugin } from '@gears-frontx/frontx-template-shell';

export const STUDIO_EVENTS_API_BASE_URL = '/cf/studio-events/v1';

/** One event as it arrives, live or replayed. */
export interface StudioEvent<P = unknown> {
  /** Monotonic per-tenant cursor: the resume point after a disconnect. */
  seq: number;
  /** Milliseconds since the Unix epoch. */
  at_ms: number;
  /** `task.queued` | `task.running` | `task.progress` | `task.succeeded` | `task.failed` | `task.cancelled` | … */
  kind: string;
  /** What the event is about: `task_run`, `workspace`, … */
  subject_type: string;
  /** The subject's id — for a background run, its run id. */
  subject_id: string;
  /** The gear that published it. */
  source: string;
  payload: P;
}

/**
 * What a `task.*` event carries: one transition of a `studio-tasks` run.
 *
 * The same run `GET /studio-tasks/v1/runs/{id}` answers with, under the
 * event's own names: `run_id` for its `id`, `phase` for `progress`, `error`
 * for `last_error`; `state` and `attempts` are the same. `phase` arrives on
 * `task.progress`; `summary` / `error` / `result` on the terminal ones.
 */
export interface StudioRunEvent {
  run_id: string;
  /** `<gear>.<verb>` — `artifact.ingest`, `connector.graph_sync`, … */
  task_type?: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  /** The phase the handler last reported. */
  phase?: string | null;
  /** One line about what it did, once it succeeded. */
  summary?: string | null;
  /** Why it stopped, once it failed. */
  error?: string | null;
  /** The handler's structured result — counts, ids, whatever it reports. */
  result?: Record<string, unknown> | null;
  attempts?: number | null;
  /**
   * On an ending: whether a person started the run. `false` for Studio's own
   * work (the scheduler's sweeps, a delivery a run queued), whose ending is
   * nobody's news. Absent from a backend that predates it.
   */
  asked_by_person?: boolean;
}

/** A page of replayed events, oldest first. */
export interface StudioEventPage {
  events: StudioEvent[];
  /**
   * The tenant's high-water mark. Above the last returned `seq` means the
   * caller fell out of the server's retained window and lost events.
   */
  latest_seq: number;
}

/** The largest page `GET /events` serves (`limit` is clamped to 500). */
const GAP_PAGE = 500;

/**
 * Everything published after `cursor` up to the tenant's high-water mark as
 * of the first page, oldest first. Stops at that mark, or at an empty page —
 * not at a short one, so a lowered server clamp cannot turn this back into a
 * one-page read; whatever is published past the mark is on the live stream.
 *
 * Fails when a page does not start right after the seq it asked from: the
 * window was pruned past it, and the events in between are gone. `seq` is not
 * dense (a failed write skips one), so a hole there fails it too — rarely.
 */
export async function pageThrough(
  read: (afterSeq: number, limit: number) => Promise<StudioEventPage>,
  cursor: number,
): Promise<StudioEvent[]> {
  const events: StudioEvent[] = [];
  let after = cursor;
  let mark: number | null = null;
  for (;;) {
    const page = await read(after, GAP_PAGE);
    mark ??= page.latest_seq;
    const first = page.events[0];
    if (first && first.seq !== after + 1) {
      throw new Error(`events ${after + 1}..${first.seq - 1} are no longer retained`);
    }
    events.push(...page.events);
    const last = page.events[page.events.length - 1];
    if (!last || last.seq >= mark) return events;
    after = last.seq;
  }
}

/** The organization a stream URL names (`?organization_id=`), or `null`. */
export function organizationOfStreamUrl(url: string | undefined): string | null {
  if (!url || !url.includes('?')) return null;
  const value = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('organization_id');
  return value ? value : null;
}

export class StudioEventsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    const sseProtocol = new SseProtocol();
    const sseStreams = new SseStreamProtocol(sseProtocol);

    super(
      { baseURL: STUDIO_EVENTS_API_BASE_URL },
      restProtocol,
      restEndpoints,
      sseProtocol,
      sseStreams,
    );

    // Authenticated SSE with gap-free resume. The plugin replaces the native
    // EventSource (which could not send the bearer at all) and, on every
    // reconnect, replays what was published while the connection was down
    // before letting any newer frame through.
    //
    // Added to the PROTOCOL instance, not through `registerPlugin`: the latter
    // only records a plugin for the framework's mock-mode toggle to activate,
    // and this one has to be on for every connection.
    sseProtocol.plugins.add(
      new SseAuthPlugin({
        resume: {
          cursorOf: (event) => (event as StudioEvent | null)?.seq,
          // The replay asks the same tenant the stream listens to: a stream
          // opened for an organization (`?organization_id=`) replays from it.
          gap: (cursor, url) => {
            const organization = organizationOfStreamUrl(url);
            const scope = organization ? `&organization_id=${encodeURIComponent(organization)}` : '';
            return pageThrough(
              (afterSeq, limit) =>
                restProtocol.get<StudioEventPage>(`/events?after_seq=${afterSeq}&limit=${limit}${scope}`),
              cursor,
            );
          },
        },
      }),
    );
  }

  /**
   * The live stream, from now on. A reconnect replays what it missed, page by
   * page ({@link pageThrough}); one that cannot keeps the stream and loses the
   * gap, logged (`streamFrom` ends instead).
   *
   * For a job you are about to start, use {@link streamFrom} with a cursor
   * read beforehand — a task can finish before this connection is even open.
   */
  readonly events = this.protocol(SseStreamProtocol).stream<StudioEvent>('/stream');

  /**
   * The live stream of one organization's tenant (`?organization_id=`): what a
   * platform administrator, or a member of several organizations, hears while
   * that organization is on screen. The server answers 404 for an organization
   * the caller does not reach. `null` is the caller's home tenant — {@link events}.
   * A reconnect replays that organization's gap, not the home tenant's.
   */
  eventsFor(organizationId: string | null) {
    if (!organizationId) return this.events;
    return this.protocol(SseStreamProtocol).stream<StudioEvent>(
      `/stream?organization_id=${encodeURIComponent(organizationId)}`,
    );
  }

  /** The retained window after `afterSeq`, oldest first. */
  readonly since = this.protocol(RestEndpointProtocol).queryWith<
    StudioEventPage,
    { afterSeq: number; limit?: number }
  >(({ afterSeq, limit }) => {
    const query = new URLSearchParams({ after_seq: String(afterSeq) });
    if (limit !== undefined) query.set('limit', String(limit));
    return `/events?${query.toString()}`;
  });

  /**
   * The tenant's current cursor, cheaply (one event at most).
   *
   * Read it BEFORE starting a background job and pass the result to
   * {@link streamFrom}: everything the job publishes is then replayed, however
   * fast it finishes.
   */
  readonly cursor = this.protocol(RestEndpointProtocol).query<StudioEventPage>(
    '/events?after_seq=0&limit=1',
  );

  // @cpt-dod:cpt-studiofrontend-dod-editor-session-replay:p1
  /**
   * The live stream, resuming at `cursor` — anything published after it is
   * replayed first, in order, without duplicates, `0` included. A replay that
   * fails, or a refused stream, ends it: the consumer's `onComplete`.
   *
   * A distinct descriptor key per cursor, so `useApiStream` opens a fresh
   * connection when the starting point changes rather than reusing the old one.
   */
  streamFrom(cursor: number) {
    return this.protocol(SseStreamProtocol).stream<StudioEvent>(
      `/stream?resume_from=${cursor}`,
    );
  }
}
