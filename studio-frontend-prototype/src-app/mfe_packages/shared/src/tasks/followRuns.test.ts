import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunFollower, readCursor, RUN_MAX_READ_FAILURES, RUN_POLL_INTERVAL_MS } from './followRuns';
import type { RunUpdate } from './runs';
import type { StudioEvent } from './StudioEventsApiService';
import type { StudioRun, StudioRunState } from './StudioTasksApiService';

function taskEvent(runId: string, state: StudioRunState, extra: object = {}): StudioEvent {
  return {
    seq: 1,
    at_ms: 0,
    kind: `task.${state}`,
    subject_type: 'task_run',
    subject_id: runId,
    source: 'studio-tasks',
    payload: { run_id: runId, state, ...extra },
  };
}

function run(id: string, state: StudioRunState): StudioRun {
  return { id, state, progress: null, summary: null, result: null, last_error: null, attempts: 1 } as StudioRun;
}

const notFound = { response: { status: 404 } };
const unavailable = { response: { status: 503 } };

function harness({ connect = 'open' }: { connect?: 'open' | 'refused' } = {}) {
  type Stream = { onEvent: ((event: StudioEvent) => void) | null; onComplete: (() => void) | null };
  const stream: Stream = { onEvent: null, onComplete: null };
  const streams: Stream[] = [];
  const disconnect = vi.fn();
  const events = {
    streamFrom: vi.fn((_cursor: number) => ({
      connect: (onEvent: (event: StudioEvent) => void, onComplete?: () => void) => {
        stream.onEvent = onEvent;
        stream.onComplete = onComplete ?? null;
        streams.push({ onEvent, onComplete: onComplete ?? null });
        return connect === 'open'
          ? Promise.resolve(`connection-${streams.length}`)
          : Promise.reject(new Error('refused'));
      },
      disconnect,
    })),
  };
  const read = vi.fn<(runId: string) => Promise<StudioRun>>((runId) => Promise.resolve(run(runId, 'running')));
  const tasks = { run: vi.fn(({ runId }: { runId: string }) => ({ fetch: () => read(runId) })) };
  const updates: RunUpdate[] = [];
  const lost: [string, unknown][] = [];
  const readFailures: number[] = [];
  const follower = createRunFollower({
    events: events as never,
    tasks: tasks as never,
    onRun: (update) => updates.push(update),
    onLost: (runId, error) => lost.push([runId, error]),
    onReadFailed: (_runId, _error, failures) => readFailures.push(failures),
  });
  return { follower, events, stream, streams, disconnect, read, updates, lost, readFailures };
}

describe('createRunFollower', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens one stream at the cursor and reports the task events of the runs it follows', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'running', { phase: 'cloning' }));
    h.stream.onEvent?.(taskEvent('r-other', 'running'));
    h.stream.onEvent?.({ ...taskEvent('r-1', 'running'), kind: 'workspace.created' });

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.events.streamFrom).toHaveBeenCalledWith(7);
    expect(h.updates).toEqual([{ runId: 'r-1', state: 'running', phase: 'cloning' }]);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('leaves out of an update what the event did not say', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'running'));

    expect(h.updates[0]).toEqual({ runId: 'r-1', state: 'running' });
    expect(h.updates[0]).not.toHaveProperty('phase');
  });

  it('closes the stream once the last run settles, and reports nothing after it', async () => {
    const h = harness();
    h.follower.follow(['r-1', 'r-2'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onEvent?.(taskEvent('r-1', 'succeeded'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.disconnect).not.toHaveBeenCalled();

    h.stream.onEvent?.(taskEvent('r-2', 'cancelled'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.disconnect).toHaveBeenCalledWith('connection-1');

    h.stream.onEvent?.(taskEvent('r-2', 'running'));
    expect(h.updates.map((u) => [u.runId, u.state])).toEqual([
      ['r-1', 'succeeded'],
      ['r-2', 'cancelled'],
    ]);
  });

  it('reads a run that joins an open stream once, for what it did before, and opens no second stream', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(5 * RUN_POLL_INTERVAL_MS);

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith('r-2');
    expect(h.updates).toEqual([expect.objectContaining({ runId: 'r-2', state: 'running' })]);
  });

  it('reads every run on an interval when the read of a run joining the stream fails', async () => {
    const h = harness();
    let joinReads = 0;
    h.read.mockImplementation((runId) => {
      if (runId !== 'r-2') return Promise.resolve(run(runId, 'running'));
      joinReads += 1;
      return joinReads === 1 ? Promise.reject(unavailable) : Promise.resolve(run('r-2', 'succeeded'));
    });
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.disconnect).toHaveBeenCalledWith('connection-1');
    expect(h.readFailures).toEqual([1]);
    expect(h.updates).toContainEqual(expect.objectContaining({ runId: 'r-2', state: 'succeeded' }));
  });

  it('reads on one interval when the stream ends while a joining run is read, and that read fails', async () => {
    const h = harness();
    let failJoin: (error: unknown) => void = () => undefined;
    let joinReads = 0;
    h.read.mockImplementation((runId) => {
      if (runId === 'r-2' && (joinReads += 1) === 1) {
        return new Promise<StudioRun>((_resolve, reject) => {
          failJoin = reject;
        });
      }
      return Promise.resolve(run(runId, 'running'));
    });
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);
    h.follower.follow(['r-2'], 9);

    h.streams[0]?.onComplete?.();
    failJoin(unavailable);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(h.read.mock.calls.map(([runId]) => runId)).toEqual(['r-2', 'r-1', 'r-2']);
  });

  it('keeps a newer stream when an older one completes late', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);
    const first = h.streams[0];
    first?.onEvent?.(taskEvent('r-1', 'succeeded'));
    await vi.advanceTimersByTimeAsync(0);

    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(0);
    first?.onComplete?.();
    await vi.advanceTimersByTimeAsync(5 * RUN_POLL_INTERVAL_MS);

    expect(h.events.streamFrom).toHaveBeenCalledTimes(2);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.disconnect).not.toHaveBeenCalledWith('connection-2');
    h.streams[1]?.onEvent?.(taskEvent('r-2', 'succeeded'));
    expect(h.updates.map((u) => [u.runId, u.state])).toEqual([
      ['r-1', 'succeeded'],
      ['r-2', 'succeeded'],
    ]);
  });

  it('ignores a run it already follows', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('reads the runs on an interval when there is no cursor, until each settles', async () => {
    const h = harness();
    h.read.mockResolvedValueOnce(run('r-1', 'running')).mockResolvedValueOnce(run('r-1', 'succeeded'));
    h.follower.follow(['r-1'], null);

    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS - 1);
    expect(h.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(10 * RUN_POLL_INTERVAL_MS);

    expect(h.events.streamFrom).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.updates.map((u) => u.state)).toEqual(['running', 'succeeded']);
  });

  it('falls back to reading on an interval when the stream ends', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.stream.onComplete?.();
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledWith('r-1');
    // A run joining now is read with the rest, not on a new stream.
    h.follower.follow(['r-2'], 9);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(h.events.streamFrom).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith('r-2');
  });

  it('falls back to reading on an interval when the stream cannot open', async () => {
    const h = harness({ connect: 'refused' });
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledWith('r-1');
  });

  it('gives a run up at once when the gear does not know it', async () => {
    const h = harness();
    h.read.mockRejectedValue(notFound);
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync(5 * RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.lost).toEqual([['r-1', notFound]]);
    expect(h.readFailures).toEqual([]);
  });

  it(`gives a run up after ${RUN_MAX_READ_FAILURES} failed reads in a row, and a good read resets the count`, async () => {
    const h = harness();
    h.read
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(run('r-1', 'running'))
      .mockRejectedValue(unavailable);
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync((RUN_MAX_READ_FAILURES + 5) * RUN_POLL_INTERVAL_MS);

    expect(h.readFailures).toEqual([1, 1, 2, 3, 4, 5]);
    expect(h.lost).toEqual([['r-1', unavailable]]);
    expect(h.read).toHaveBeenCalledTimes(RUN_MAX_READ_FAILURES + 2);
  });

  it('stop closes the stream and reports nothing more', async () => {
    const h = harness();
    h.follower.follow(['r-1'], 7);
    await vi.advanceTimersByTimeAsync(0);

    h.follower.stop();
    await vi.advanceTimersByTimeAsync(0);
    h.stream.onEvent?.(taskEvent('r-1', 'succeeded'));

    expect(h.disconnect).toHaveBeenCalledWith('connection-1');
    expect(h.updates).toEqual([]);
  });

  it('reports nothing about a read that fails after stop', async () => {
    const h = harness();
    let fail: (error: unknown) => void = () => undefined;
    h.read.mockImplementation(
      () =>
        new Promise<StudioRun>((_resolve, reject) => {
          fail = reject;
        })
    );
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(h.read).toHaveBeenCalledTimes(1);

    h.follower.stop();
    fail(unavailable);
    await vi.advanceTimersByTimeAsync(0);

    expect(h.readFailures).toEqual([]);
    expect(h.lost).toEqual([]);
  });

  it('stop ends the reads on an interval', async () => {
    const h = harness();
    h.follower.follow(['r-1'], null);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    h.follower.stop();
    await vi.advanceTimersByTimeAsync(10 * RUN_POLL_INTERVAL_MS);

    expect(h.read).toHaveBeenCalledTimes(1);
  });
});

describe('readCursor', () => {
  it("is the tenant's latest seq, read past the cache", async () => {
    const fetch = vi.fn().mockResolvedValue({ events: [], latest_seq: 42 });

    expect(await readCursor({ cursor: { fetch } } as never, 'test')).toBe(42);
    expect(fetch).toHaveBeenCalledWith({ staleTime: 0 });
  });

  it('is null when the cursor cannot be read, and says so under the label', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi.fn().mockRejectedValue(new Error('down'));

    expect(await readCursor({ cursor: { fetch } } as never, 'test')).toBeNull();
    expect(warn).toHaveBeenCalledWith('[test] no event cursor:', expect.any(String));
    warn.mockRestore();
  });
});
