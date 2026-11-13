import { describe, expect, it } from 'vitest';
import { STUDIO_TASKS_API_BASE_URL, StudioTasksApiService } from './StudioTasksApiService';

/**
 * The descriptors, and nothing else: the effects suite replaces this service
 * with a mock, so a wrong path or verb here would pass every other test.
 */
describe('StudioTasksApiService', () => {
  const service = new StudioTasksApiService();

  it('is mounted under the gateway prefix', () => {
    expect(STUDIO_TASKS_API_BASE_URL).toBe('/cf/studio-tasks/v1');
  });

  it('reads one run by id, encoded in the path segment', () => {
    expect(service.run({ runId: 'r-1' }).key.slice(0, 3)).toEqual(['/cf/studio-tasks/v1', 'GET', '/runs/r-1']);
    expect(service.run({ runId: 'a/b' }).key[2]).toBe('/runs/a%2Fb');
  });

  it('lists one type of run in one state, with the page size only when asked', () => {
    expect(service.runs({ taskType: 'artifact.ingest', state: 'running' }).key.slice(0, 3)).toEqual([
      '/cf/studio-tasks/v1',
      'GET',
      '/runs?task_type=artifact.ingest&state=running',
    ]);
    expect(service.runs({ taskType: 'artifact.ingest', state: 'queued', limit: 200 }).key[2]).toBe(
      '/runs?task_type=artifact.ingest&state=queued&limit=200'
    );
  });

  it('asks a run to stop with a POST to its cancel action', () => {
    expect(service.cancel('r-1').key).toEqual(['/cf/studio-tasks/v1', 'POST', '/runs/r-1/cancel']);
  });

  it('puts a run back on the queue with a POST to its retry action', () => {
    expect(service.retry('r-1').key).toEqual(['/cf/studio-tasks/v1', 'POST', '/runs/r-1/retry']);
    expect(service.retry('a/b').key[2]).toBe('/runs/a%2Fb/retry');
  });
});
