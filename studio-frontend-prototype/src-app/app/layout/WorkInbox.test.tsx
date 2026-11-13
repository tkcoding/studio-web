import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StudioEvent } from '@constructor-studio/mfe-shared';

/**
 * The bell (the prototype's `WorkInbox`): it hears the shell's live channel,
 * counts the endings a person started, and hands over to Background work.
 */

const { mockEventBus, screens, channel } = vi.hoisted(() => ({
  mockEventBus: { emit: vi.fn() },
  screens: [] as Array<{ id: string; presentation: { label: string; route: string; level?: string } }>,
  channel: { listeners: new Set<(event: unknown) => void>() },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: mockEventBus,
  useDomainExtensions: () => screens,
}));
vi.mock('@/app/i18n/shellTranslations', () => import('@frontx-test-utils/shellText'));
vi.mock('@/app/live/liveChannel', () => ({
  liveChannel: () => ({
    start: () => () => undefined,
    status: () => 'open',
    subscribe: (listener: (event: unknown) => void) => {
      channel.listeners.add(listener);
      return () => channel.listeners.delete(listener);
    },
  }),
}));

import { WorkInbox, BACKGROUND_WORK_ROUTE } from './WorkInbox';

let seq = 0;
function hear(payload: Record<string, unknown>) {
  seq += 1;
  const event: StudioEvent = {
    seq,
    at_ms: Date.now(),
    kind: `task.${String(payload.state)}`,
    subject_type: 'task_run',
    subject_id: `run-${seq}`,
    source: 'studio-tasks',
    payload: { run_id: `run-${seq}`, ...payload },
  };
  act(() => {
    for (const listener of channel.listeners) listener(event);
  });
}

const bell = () => screen.getByRole('button', { name: 'Recently finished' });
const count = () => document.querySelector('[data-work-inbox-count]')?.textContent ?? null;

describe('WorkInbox', () => {
  beforeEach(() => {
    screens.length = 0;
    screens.push({ id: 'ext.tasks', presentation: { label: 'Background work', route: BACKGROUND_WORK_ROUTE, level: 'organization' } });
  });

  afterEach(() => {
    cleanup();
    channel.listeners.clear();
    vi.clearAllMocks();
  });

  it('counts the runs that ended, and nothing else', () => {
    render(<WorkInbox />);
    expect(count()).toBeNull();
    hear({ state: 'running', task_type: 'artifact.ingest' });
    hear({ state: 'succeeded', task_type: 'artifact.ingest', summary: '12 files' });
    hear({ state: 'failed', task_type: 'catalog.sync', error: 'GitHub said 401' });
    hear({ state: 'succeeded', task_type: 'tasks.retention_sweep', asked_by_person: false });
    expect(count()).toBe('2');
    expect(bell().getAttribute('title')).toBe('2 finished since you last looked');
  });

  it('lists them newest first when opened, and reads them all', () => {
    render(<WorkInbox />);
    hear({ state: 'succeeded', task_type: 'artifact.ingest', summary: '12 files' });
    hear({ state: 'failed', task_type: 'catalog.sync', error: 'GitHub said 401' });
    fireEvent.click(bell());
    const rows = Array.from(document.querySelectorAll('[data-work-inbox-run]'));
    expect(rows.map((row) => row.getAttribute('data-work-inbox-run'))).toEqual(['failed', 'succeeded']);
    expect(rows[0].textContent).toContain('Catalog sync');
    expect(rows[0].textContent).toContain('GitHub said 401');
    expect(rows[1].textContent).toContain('just now');
    expect(count()).toBeNull();
  });

  it('says when nothing has finished yet', () => {
    render(<WorkInbox />);
    fireEvent.click(bell());
    expect(screen.getByText('Nothing has finished since you opened the portal.')).toBeTruthy();
  });

  it('hands over to Background work', () => {
    render(<WorkInbox />);
    fireEvent.click(bell());
    fireEvent.click(screen.getByText('Background work'));
    expect(mockEventBus.emit).toHaveBeenCalledWith('app/context/screen/requested', { extensionId: 'ext.tasks' });
  });

  it('offers no hand-over where Background work is not registered', () => {
    screens.length = 0;
    render(<WorkInbox />);
    fireEvent.click(bell());
    expect(screen.queryByText('Background work')).toBeNull();
  });
});
