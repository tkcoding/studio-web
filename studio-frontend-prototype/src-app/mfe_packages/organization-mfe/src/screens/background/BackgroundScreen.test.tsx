import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRun } from '../../background/types';

const { service, calls, live } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as string[],
  live: { value: null as unknown },
}));

vi.mock('../../i18n', () => ({
  useBackgroundTranslations: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    loading: false,
  }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  // The shell's live channel relays its last event under its own property; every other read here is the language.
  useSharedProperty: (id: string) => (id.includes('live.studio_events') ? live.value : 'en'),
}));

import { BackgroundScreen } from './BackgroundScreen';

const run = (id: string, state: string, task_type = 'catalog.sync'): TaskRun =>
  ({
    id: `${id}-0000-0000`,
    tenant_id: 't',
    task_type,
    state,
    payload: {},
    attempts: 1,
    cancel_requested: false,
    requested_by: 'someone',
    created_at: '2026-11-04T10:00:00Z',
    updated_at: '2026-11-04T10:00:00Z',
    last_error: state === 'failed' ? 'the token was refused' : null,
  }) as TaskRun;

describe('BackgroundScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    live.value = null;
    Object.assign(service, {
      taskTypes: { fetch: () => Promise.resolve({ items: ['catalog.sync'] }) },
      schedules: {
        fetch: () =>
          Promise.resolve({
            items: [
              {
                id: 's1',
                name: 'Nightly catalogue',
                task_type: 'catalog.sync',
                payload: {},
                expression_kind: 'cron',
                expression: '0 3 * * *',
                timezone: 'UTC',
                concurrency: 'forbid',
                missed_policy: 'skip',
                max_catch_up_runs: 0,
                enabled: true,
                next_run_at: '2026-11-05T03:00:00Z',
                created_at: '',
              },
            ],
          }),
      },
      runs: ({ state }: { state?: string }) => ({
        fetch: () => {
          calls.push(state ?? 'every');
          return Promise.resolve(
            state === 'failed' ? { items: [run('f1', 'failed')], total: 1 } : { items: [], total: 0 }
          );
        },
      }),
      retry: (id: string) => ({ fetch: () => (calls.push(`retry:${id}`), Promise.resolve({})) }),
      cancel: () => ({ fetch: () => Promise.resolve({}) }),
      runNow: (id: string) => ({ fetch: () => (calls.push(`run-now:${id}`), Promise.resolve({ run_id: 'r' })) }),
    });
  });

  it('opens on what failed and what is running, and retries a failed run', async () => {
    render(<BackgroundScreen />);
    expect(await screen.findByText('the token was refused')).toBeTruthy();
    expect(calls).toEqual(expect.arrayContaining(['failed', 'running']));
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(calls).toContain('retry:f1-0000-0000'));
  });

  it('runs a schedule now', async () => {
    render(<BackgroundScreen />);
    expect(await screen.findByText('Nightly catalogue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'run_now' }));
    await waitFor(() => expect(calls).toContain('run-now:s1'));
  });

  it('reads the runs again when the shell relays a run transition', async () => {
    const view = render(<BackgroundScreen />);
    expect(await screen.findByText('the token was refused')).toBeTruthy();
    const before = calls.filter((c) => c === 'failed').length;
    live.value = { seq: 7, at_ms: 1, kind: 'task.succeeded', subject_type: 'task_run', subject_id: 'r', source: 'studio-tasks', payload: {} };
    view.rerender(<BackgroundScreen />);
    await waitFor(() => expect(calls.filter((c) => c === 'failed').length).toBeGreaterThan(before));
  });

  it('does not read again for an event about something else', async () => {
    const view = render(<BackgroundScreen />);
    expect(await screen.findByText('the token was refused')).toBeTruthy();
    const before = calls.length;
    live.value = { seq: 8, at_ms: 1, kind: 'workspace.created', subject_type: 'workspace', subject_id: 'w', source: 'x', payload: {} };
    view.rerender(<BackgroundScreen />);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls.length).toBe(before);
  });
});
