/**
 * Studio Tasks Domain - API Service
 *
 * One background run of `studio-tasks`, read by id, cancelled, and put back on the queue.
 * Its transitions arrive on studio-events; these reads are for when the stream
 * cannot say.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { StudioRunEvent } from './StudioEventsApiService';

export const STUDIO_TASKS_API_BASE_URL = '/cf/studio-tasks/v1';

export type StudioRunState = StudioRunEvent['state'];

/** `RunDto`. */
export interface StudioRun {
  id: string;
  tenant_id: string;
  task_type: string;
  state: StudioRunState;
  payload: unknown;
  partition_key: string | null;
  attempts: number;
  progress: string | null;
  summary: string | null;
  result: Record<string, unknown> | null;
  last_error: string | null;
  cancel_requested: boolean;
  requested_by: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface StudioRunList {
  items: StudioRun[];
  total: number;
}

export interface RunsParams {
  taskType: string;
  state: StudioRunState;
  /** 1..=200; the gear's default is 50. */
  limit?: number;
}

function runPath({ runId }: { runId: string }): string {
  return `/runs/${encodeURIComponent(runId)}`;
}

export function runsPath({ taskType, state, limit }: RunsParams): string {
  const query = new URLSearchParams({ task_type: taskType, state });
  if (limit !== undefined) query.set('limit', String(limit));
  return `/runs?${query.toString()}`;
}

export class StudioTasksApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: STUDIO_TASKS_API_BASE_URL }, restProtocol, restEndpoints);
  }

  /** Read with `staleTime: 0`: the shared cache would answer one state per 30 s. */
  readonly run = this.protocol(RestEndpointProtocol).queryWith<StudioRun, { runId: string }>(runPath);

  readonly runs = this.protocol(RestEndpointProtocol).queryWith<StudioRunList, RunsParams>(runsPath);

  /**
   * Asks the run to stop. Only a flag: the run ends `cancelled` once its
   * handler returns. Refused (`TASK_CANCEL_REFUSED`) for a run that has ended.
   */
  cancel(runId: string) {
    return this.protocol(RestEndpointProtocol).mutation<StudioRun, void>(
      'POST',
      `${runPath({ runId })}/cancel`
    );
  }

  /** Back on the queue. Refused for a run that succeeded or has not ended. */
  retry(runId: string) {
    return this.protocol(RestEndpointProtocol).mutation<StudioRun, void>(
      'POST',
      `${runPath({ runId })}/retry`
    );
  }
}
