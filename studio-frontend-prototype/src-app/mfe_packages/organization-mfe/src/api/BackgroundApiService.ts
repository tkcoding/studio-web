/**
 * Background work (ADR-0069 parity: Organization › Background work): the runs
 * `studio-tasks` keeps and the schedules `studio-scheduler` fires.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { TaskRun, TaskSchedule } from '../background/types';

export interface RunsQuery {
  state?: string;
  taskType?: string;
  limit: number;
  offset?: number;
}

function runsPath({ state, taskType, limit, offset }: RunsQuery): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (state) q.set('state', state);
  if (taskType) q.set('task_type', taskType);
  if (offset) q.set('offset', String(offset));
  return `/studio-tasks/v1/runs?${q}`;
}

export class BackgroundApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf' }, restProtocol, restEndpoints);
  }

  readonly runs = this.protocol(RestEndpointProtocol).queryWith<{ items: TaskRun[]; total?: number }, RunsQuery>(
    runsPath
  );

  readonly taskTypes = this.protocol(RestEndpointProtocol).query<{ items: string[] }>('/studio-tasks/v1/task-types');

  readonly schedules = this.protocol(RestEndpointProtocol).query<{ items: TaskSchedule[] }>(
    '/studio-scheduler/v1/schedules'
  );

  cancel(runId: string) {
    return this.protocol(RestEndpointProtocol).mutation<TaskRun, void>(
      'POST',
      `/studio-tasks/v1/runs/${encodeURIComponent(runId)}/cancel`
    );
  }

  retry(runId: string) {
    return this.protocol(RestEndpointProtocol).mutation<TaskRun, void>(
      'POST',
      `/studio-tasks/v1/runs/${encodeURIComponent(runId)}/retry`
    );
  }

  runNow(scheduleId: string) {
    return this.protocol(RestEndpointProtocol).mutation<{ run_id: string }, void>(
      'POST',
      `/studio-scheduler/v1/schedules/${encodeURIComponent(scheduleId)}/run-now`
    );
  }
}
