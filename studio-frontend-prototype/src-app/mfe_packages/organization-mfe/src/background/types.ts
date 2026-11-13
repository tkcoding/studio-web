/** The shapes of studio-tasks runs and studio-scheduler schedules, as the prototype's
 *  client had them (src/api.ts at 00828880). */

export interface TaskRun {
  id: string;
  tenant_id: string;
  /** `<gear>.<verb>` — `connector.graph_sync`, `notify.deliver`. */
  task_type: string;
  /** `queued` | `running` | `succeeded` | `failed` | `cancelled`. */
  state: string;
  /** What the handler was given. Shape belongs to the task type. */
  payload: Record<string, unknown>;
  /** What the run was told not to overtake, when ordering was asked for. */
  partition_key?: string | null;
  attempts: number;
  /** The phase the handler last reported; kept after it ends. */
  progress?: string | null;
  /** One line about what it did, once it succeeded. */
  summary?: string | null;
  /** The handler's structured result, where it has one. */
  result?: Record<string, unknown> | null;
  last_error?: string | null;
  cancel_requested: boolean;
  requested_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface TaskSchedule {
  id: string;
  name: string;
  task_type: string;
  payload: Record<string, unknown>;
  /** `cron` | `interval`. */
  expression_kind: string;
  /** A 5-field cron expression, or an ISO-8601 duration. */
  expression: string;
  timezone: string;
  /** `allow` | `forbid` | `replace`. */
  concurrency: string;
  /** `skip` | `catch_up` | `backfill`. */
  missed_policy: string;
  max_catch_up_runs: number;
  enabled: boolean;
  next_run_at: string;
  last_fired_at?: string | null;
  /** The run the last firing produced. */
  last_run_id?: string | null;
  created_at: string;
  updated_at: string;
}
