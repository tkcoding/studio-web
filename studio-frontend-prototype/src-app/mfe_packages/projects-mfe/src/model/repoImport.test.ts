import { describe, expect, it } from 'vitest';
import type { StudioRun } from '@constructor-studio/mfe-shared';
import { projectRuns } from './repoImport';

const PROJECT = 'p-1';

function run(id: string, state: StudioRun['state'], payload: unknown): StudioRun {
  return {
    id,
    tenant_id: 't',
    task_type: 'artifact.ingest',
    state,
    payload,
    partition_key: null,
    attempts: 1,
    progress: null,
    summary: null,
    result: null,
    last_error: null,
    cancel_requested: false,
    requested_by: 'u',
    created_at: '',
    updated_at: '',
    started_at: null,
    finished_at: null,
  };
}

const sync = (id: string, state: StudioRun['state'], repo: string, projectId = PROJECT) =>
  run(id, state, { project_id: projectId, repo_full_path: repo });

const found = (runs: StudioRun[]) =>
  projectRuns(runs, PROJECT).map(({ repo, update }) => [repo, update.runId]);

describe("a project's syncs among the listed runs", () => {
  it('keeps the newest of two queued runs of one repository, since the gear lists newest first', () => {
    expect(found([sync('r-2', 'queued', 'acme/api'), sync('r-1', 'queued', 'acme/api')])).toEqual([
      ['acme/api', 'r-2'],
    ]);
  });

  it('keeps a running run over a queued one, whichever is listed first', () => {
    expect(found([sync('r-2', 'queued', 'acme/api'), sync('r-1', 'running', 'acme/api')])).toEqual([
      ['acme/api', 'r-1'],
    ]);
  });

  it("leaves out another project's runs", () => {
    expect(found([sync('r-1', 'running', 'acme/api', 'p-2')])).toEqual([]);
  });

  it('leaves out a run whose payload names no repository, or is not an object', () => {
    expect(
      found([
        run('r-1', 'running', { project_id: PROJECT }),
        run('r-2', 'running', { project_id: PROJECT, repo_full_path: 7 }),
        run('r-3', 'running', null),
      ])
    ).toEqual([]);
  });
});
