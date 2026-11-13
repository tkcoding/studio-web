import { describe, expect, it } from 'vitest';
import type { StudioEvent } from '@constructor-studio/mfe-shared';
import {
  KEEP,
  NO_COMPLETED_WORK,
  addCompleted,
  ago,
  completedRunOf,
  markRead,
  runLine,
  taskLabel,
  type CompletedRun,
} from './completedWork';

function runEvent(payload: Record<string, unknown>, extra: Partial<StudioEvent> = {}): StudioEvent {
  return {
    seq: 1,
    at_ms: 1000,
    kind: 'task.succeeded',
    subject_type: 'task_run',
    subject_id: 'run-1',
    source: 'studio-tasks',
    payload: { run_id: 'run-1', ...payload },
    ...extra,
  };
}

const run = (runId: string): CompletedRun => ({ runId, taskType: 'artifact.ingest', state: 'succeeded', atMs: 1 });

describe('taskLabel', () => {
  it('says a task type the way a person would', () => {
    expect(taskLabel('artifact.ingest')).toBe('Artifact ingest');
    expect(taskLabel('connector.graph_sync')).toBe('Connector graph sync');
    expect(taskLabel('')).toBe('Background work');
  });
});

describe('runLine', () => {
  it('takes the summary, else the reason, else nothing', () => {
    expect(runLine({ run_id: 'r', state: 'succeeded', summary: ' 12 files ' })).toBe('12 files');
    expect(runLine({ run_id: 'r', state: 'failed', error: 'GitHub said 401' })).toBe('GitHub said 401');
    expect(runLine({ run_id: 'r', state: 'cancelled', summary: '  ' })).toBeUndefined();
  });
});

describe('completedRunOf', () => {
  it('turns an ending into an entry', () => {
    expect(completedRunOf(runEvent({ state: 'failed', task_type: 'catalog.sync', error: 'boom' }))).toEqual({
      runId: 'run-1',
      taskType: 'catalog.sync',
      state: 'failed',
      line: 'boom',
      atMs: 1000,
    });
  });

  it('is not news while a run is queued or half-way', () => {
    expect(completedRunOf(runEvent({ state: 'running' }))).toBeNull();
    expect(completedRunOf(runEvent({ state: 'queued' }))).toBeNull();
  });

  it("keeps quiet about Studio's own work", () => {
    expect(completedRunOf(runEvent({ state: 'succeeded', asked_by_person: false }))).toBeNull();
    // A backend that predates the flag: announced.
    expect(completedRunOf(runEvent({ state: 'succeeded' }))).not.toBeNull();
  });

  it('ignores what is not a run', () => {
    expect(completedRunOf(runEvent({ state: 'succeeded' }, { subject_type: 'workspace' }))).toBeNull();
  });

  it('falls back to the subject id and a plain name', () => {
    const entry = completedRunOf({ ...runEvent({ state: 'succeeded' }), payload: { state: 'succeeded' } });
    expect(entry?.runId).toBe('run-1');
    expect(entry?.taskType).toBe('background work');
  });
});

describe('addCompleted / markRead', () => {
  it('puts the newest first and counts it unread', () => {
    const work = addCompleted(addCompleted(NO_COMPLETED_WORK, run('a')), run('b'));
    expect(work.runs.map((r) => r.runId)).toEqual(['b', 'a']);
    expect(work.unread).toBe(2);
  });

  it('counts a run that ends twice once', () => {
    const once = addCompleted(NO_COMPLETED_WORK, run('a'));
    expect(addCompleted(once, run('a'))).toBe(once);
  });

  it(`keeps the last ${KEEP}`, () => {
    let work = NO_COMPLETED_WORK;
    for (let i = 0; i < KEEP + 5; i += 1) work = addCompleted(work, run(`r${i}`));
    expect(work.runs).toHaveLength(KEEP);
    expect(work.runs[0].runId).toBe(`r${KEEP + 4}`);
  });

  it('reads them all at once', () => {
    const work = markRead(addCompleted(NO_COMPLETED_WORK, run('a')));
    expect(work.unread).toBe(0);
    expect(work.runs).toHaveLength(1);
    expect(markRead(work)).toBe(work);
  });
});

describe('ago', () => {
  it('names the one unit that matters at this distance', () => {
    expect(ago(0, 30_000)).toEqual({ unit: 'now', count: 0 });
    expect(ago(0, 5 * 60_000)).toEqual({ unit: 'm', count: 5 });
    expect(ago(0, 3 * 3_600_000)).toEqual({ unit: 'h', count: 3 });
    expect(ago(0, 49 * 3_600_000)).toEqual({ unit: 'd', count: 2 });
    expect(ago(10_000, 0)).toEqual({ unit: 'now', count: 0 });
  });
});
