import { describe, expect, it, vi } from 'vitest';
import { FetchEventSource } from '../FetchEventSource';

/** The run every event below is about. `subject_id` is the run id. */
const RUN_ID = '9c8c6d5e-2f1a-4b7c-8d3e-6a5b4c3d2e1f';

/** An event as the studio-events backend serialises it: `studio-tasks`
 *  announcing one transition of a run. */
function event(seq: number, kind = 'task.running') {
  return {
    seq,
    at_ms: 1_700_000_000_000 + seq,
    kind,
    subject_type: 'task_run',
    subject_id: RUN_ID,
    source: 'studio-tasks',
    payload: { run_id: RUN_ID, task_type: 'artifact.ingest', state: kind.slice('task.'.length) },
  };
}

/** An SSE body: unnamed frames plus the keep-alive comment the server sends. */
function sseResponse(events: object[], { keepAlive = true } = {}): Response {
  const text =
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') +
    (keepAlive ? ': keepalive\n\n' : '');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Two chunks split mid-frame, so the reader's buffering is exercised
      // rather than assumed.
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Never settles: parks the reconnect loop so a test can assert in peace. */
function pending(): Promise<Response> {
  return new Promise<Response>(() => {});
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('FetchEventSource', () => {
  it('sends the bearer, parses unnamed frames across chunks, and ignores keep-alives', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse([event(1), event(2)]))
      .mockImplementation(pending);

    const source = new FetchEventSource('/cf/studio-events/v1/stream', {
      getToken: () => 'tok',
      fetchImpl,
    });
    const seen: string[] = [];
    source.onmessage = (e) => seen.push(e.data as string);

    await until(() => seen.length === 2, 'both frames');
    source.close();

    expect(seen.map((d) => JSON.parse(d).seq)).toEqual([1, 2]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer tok', Accept: 'text/event-stream' }),
    });
  });

  it('fires `open` only after the constructor returns, so handlers set on the next line still see it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(sseResponse([])));
    const source = new FetchEventSource('/stream', { fetchImpl });
    let opened = false;
    source.onopen = () => {
      opened = true;
    };

    await until(() => opened, 'the open event');
    source.close();
    expect(opened).toBe(true);
  });

  it('reconnects when the stream ends, without surfacing an error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse([event(1)], { keepAlive: false }))
      .mockResolvedValueOnce(sseResponse([event(2)], { keepAlive: false }))
      .mockImplementation(pending);

    const source = new FetchEventSource('/stream', { fetchImpl });
    const seen: number[] = [];
    source.onmessage = (e) => seen.push(JSON.parse(e.data as string).seq);
    const errors: unknown[] = [];
    source.onerror = (e) => errors.push(e);

    await until(() => seen.length === 2, 'a frame from each connection');
    source.close();

    expect(seen).toEqual([1, 2]);
    // A dropped connection is not the consumer's problem: surfacing it as
    // `onerror` would make SseProtocol tear the connection down for good.
    expect(errors).toEqual([]);
  });

  it('replays the gap on reconnect and drops the overlap', async () => {
    // First connection delivers 1 and 2 and ends. The reconnect carries 4 and
    // 5 live while the catch-up page holds 3 and 4 — so 4 must not arrive
    // twice, and nothing may arrive out of order.
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((input) => {
      const url = String(input);
      if (url.includes('after_seq=')) {
        return Promise.resolve(jsonResponse({ events: [event(3), event(4)], latest_seq: 5 }));
      }
      return fetchImpl.mock.calls.filter(([u]) => !String(u).includes('after_seq=')).length === 1
        ? Promise.resolve(sseResponse([event(1), event(2)], { keepAlive: false }))
        : Promise.resolve(sseResponse([event(4), event(5)]));
    });

    const seen: number[] = [];
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: {
        cursorOf: (e) => (e as { seq: number }).seq,
        gap: async (cursor) => {
          const page = (await fetchImpl(`/events?after_seq=${cursor}`)) as Response;
          return ((await page.json()) as { events: unknown[] }).events;
        },
      },
    });
    source.onmessage = (e) => seen.push(JSON.parse(e.data as string).seq);

    await until(() => seen.length >= 5, 'both connections plus the replayed gap');
    source.close();

    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives up on 401 instead of hammering the gateway, and reports it once', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 401 }));

    const source = new FetchEventSource('/stream', { fetchImpl });
    const errors: unknown[] = [];
    source.onerror = (e) => errors.push(e);
    // SseProtocol swallows `onerror`; `done` is what a waiting consumer hears.
    let ended = false;
    source.addEventListener('done', () => {
      ended = true;
    });

    await until(() => errors.length === 1, 'the error to surface');
    // Give the loop a chance to retry if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(source.readyState).toBe(2); // CLOSED
    // Nobody gave a cursor, so nobody is waiting on `done`: a refusal only stops the stream and fires `error`.
    expect(ended).toBe(false);
  });

  it('tells a consumer waiting from a cursor that a refused stream is over', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: { cursorOf: (e) => (e as { seq: number }).seq, gap: async () => [], from: 0 },
    });
    let ended = false;
    source.addEventListener('done', () => {
      ended = true;
    });

    await until(() => ended, 'the consumer to be told');

    expect(source.readyState).toBe(2); // CLOSED
  });

  it('says nothing to a consumer that closed the stream while a replay was still out', async () => {
    let rejectGap: (error: Error) => void = () => undefined;
    const gap = () =>
      new Promise<readonly unknown[]>((_resolve, reject) => {
        rejectGap = reject;
      });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(sseResponse([])).mockImplementation(pending);
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: { cursorOf: (e) => (e as { seq: number }).seq, gap, from: 0 },
    });
    let ended = false;
    source.addEventListener('done', () => {
      ended = true;
    });

    await until(() => source.readyState === 1, 'the connection to open');
    source.close();
    rejectGap(new Error('catch-up unavailable'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(ended).toBe(false);
  });

  it('routes named frames to listeners, not to onmessage', async () => {
    const body = new Response(`event: done\ndata: {}\n\n`, { status: 200 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(body).mockImplementation(pending);

    const source = new FetchEventSource('/stream', { fetchImpl });
    const messages: unknown[] = [];
    source.onmessage = (e) => messages.push(e.data);
    let done = false;
    source.addEventListener('done', () => {
      done = true;
    });

    await until(() => done, 'the completion frame');
    source.close();

    // `done` is the protocol's completion signal, not an event for consumers.
    expect(messages).toEqual([]);
  });

  it('replays from a starting cursor of 0 on the first connect, before any live frame', async () => {
    const gap = vi.fn(async (cursor: number) => (cursor === 0 ? [event(1), event(2)] : []));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse([event(2), event(3)]))
      .mockImplementation(pending);

    const seen: number[] = [];
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: { cursorOf: (e) => (e as { seq: number }).seq, gap, from: 0 },
    });
    source.onmessage = (e) => seen.push(JSON.parse(e.data as string).seq);

    // Sequences start at 1: a cursor of 0 read before a launch is a real starting point.
    await until(() => seen.length === 3, 'the replayed events and the live one');
    source.close();

    expect(gap).toHaveBeenCalledWith(0, expect.any(String));
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reports a replay it could not make, and delivers nothing past the hole', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse([event(5)]))
      .mockImplementation(pending);

    const seen: number[] = [];
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: {
        cursorOf: (e) => (e as { seq: number }).seq,
        gap: () => Promise.reject(new Error('catch-up unavailable')),
        from: 0,
      },
    });
    source.onmessage = (e) => seen.push(JSON.parse(e.data as string).seq);
    let ended = false;
    // `done` is what SseProtocol hands the consumer as `onComplete`.
    source.addEventListener('done', () => {
      ended = true;
    });

    await until(() => ended, 'the consumer to be told');

    expect(seen).toEqual([]);
    expect(source.readyState).toBe(2); // CLOSED
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps a stream given no starting cursor running past a replay it could not make, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse([event(1)], { keepAlive: false }))
      .mockResolvedValueOnce(sseResponse([event(3)]))
      .mockImplementation(pending);

    const seen: number[] = [];
    let ended = false;
    const source = new FetchEventSource('/stream', {
      fetchImpl,
      resume: {
        cursorOf: (e) => (e as { seq: number }).seq,
        gap: () => Promise.reject(new Error('catch-up unavailable')),
      },
    });
    source.onmessage = (e) => seen.push(JSON.parse(e.data as string).seq);
    source.addEventListener('done', () => {
      ended = true;
    });

    await until(() => seen.length === 2, 'the frame after the hole');
    source.close();

    expect(seen).toEqual([1, 3]);
    expect(ended).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
