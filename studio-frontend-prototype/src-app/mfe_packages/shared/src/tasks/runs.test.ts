import { describe, expect, it } from 'vitest';
import { runCount, runUpdateFromEvent, runUpdateFromRun } from './runs';
import type { StudioEvent } from './StudioEventsApiService';
import type { StudioRun } from './StudioTasksApiService';

function taskEvent(kind: string, payload: object): StudioEvent {
  return {
    seq: 1,
    at_ms: 0,
    kind,
    subject_type: 'task_run',
    subject_id: 'r-1',
    source: 'studio-tasks',
    payload: { run_id: 'r-1', ...payload },
  };
}

describe('runUpdateFromEvent', () => {
  it('carries every field the event said', () => {
    const update = runUpdateFromEvent(
      taskEvent('task.failed', {
        state: 'failed',
        phase: 'pulling issues…',
        summary: 'pulled 3 of 5',
        error: 'rate limited',
        result: { stored: 3 },
      })
    );

    expect(update).toEqual({
      runId: 'r-1',
      state: 'failed',
      phase: 'pulling issues…',
      summary: 'pulled 3 of 5',
      error: 'rate limited',
      result: { stored: 3 },
    });
  });

  it('keeps a field said as null, which clears it', () => {
    const update = runUpdateFromEvent(
      taskEvent('task.running', { state: 'running', phase: null, summary: null, error: null, result: null })
    );

    expect(update).toEqual({ runId: 'r-1', state: 'running', phase: null, summary: null, error: null, result: null });
  });

  it('leaves out a field the event did not say, which did not change', () => {
    const update = runUpdateFromEvent(taskEvent('task.running', { state: 'running' }));

    expect(update).toEqual({ runId: 'r-1', state: 'running' });
    for (const field of ['phase', 'summary', 'error', 'result']) expect(update).not.toHaveProperty(field);
  });
});

describe('runUpdateFromRun', () => {
  it('says every field, under the event names', () => {
    const run: StudioRun = {
      id: 'r-1',
      tenant_id: 't',
      task_type: 'artifact.ingest',
      state: 'failed',
      payload: {},
      partition_key: null,
      attempts: 2,
      progress: 'pulling issues…',
      summary: null,
      result: { stored: 40 },
      last_error: 'rate limited',
      cancel_requested: false,
      requested_by: 'u',
      created_at: '',
      updated_at: '',
      started_at: null,
      finished_at: null,
    };

    expect(runUpdateFromRun(run)).toEqual({
      runId: 'r-1',
      state: 'failed',
      phase: 'pulling issues…',
      summary: null,
      error: 'rate limited',
      result: { stored: 40 },
    });
  });
});

describe('runCount', () => {
  it('is the count when the result has a finite number under the key', () => {
    expect(runCount({ stored: 3 }, 'stored')).toBe(3);
  });

  it('is 0 for anything else', () => {
    expect(runCount({ stored: '3' }, 'stored')).toBe(0);
    expect(runCount({ stored: Number.NaN }, 'stored')).toBe(0);
    expect(runCount({ stored: Number.POSITIVE_INFINITY }, 'stored')).toBe(0);
    expect(runCount({}, 'stored')).toBe(0);
    expect(runCount(null, 'stored')).toBe(0);
    expect(runCount(undefined, 'stored')).toBe(0);
  });
});
