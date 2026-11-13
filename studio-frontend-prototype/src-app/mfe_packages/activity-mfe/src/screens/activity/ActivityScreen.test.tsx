import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenText } from '@constructor-studio/mfe-shared';

const { service } = vi.hoisted(() => ({ service: {} as Record<string, unknown> }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { ActivityScreen } from './ActivityScreen';

const t = Object.assign(
  (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  { count: (key: string, n: number) => `${key}:${n}` }
) as unknown as ScreenText;

const feed = (items: unknown[] | Error) => () => ({
  fetch: () => (items instanceof Error ? Promise.reject(items) : Promise.resolve({ items, total: items.length })),
});

const check = (id: string, subject = `doc-${id}.md`) => ({
  id,
  kind: 'check',
  event: 'Document checked',
  subject,
  by: 'leak',
  recorded: '2026-11-01T10:00:00Z',
});
const comment = (id: string) => ({ id, kind: 'comment', event: 'Commented', subject: 'README.md', by: 'ann', recorded: null });

describe('Project › Activity', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/projects/activity');
  });
  afterEach(cleanup);

  it('opens on the comments when there are any, with both counts in the header', async () => {
    service.activity = feed([check('a'), comment('x')]);
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => expect(screen.getByText('comments:1')).toBeTruthy());
    expect(screen.getByText('checks:1')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /kind_comment/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Commented')).toBeTruthy();
    expect(screen.queryByText('Document checked')).toBeNull();
  });

  it('switches to everything, and keeps the choice in the address', async () => {
    service.activity = feed([check('a'), comment('x')]);
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => screen.getByText('Commented'));
    fireEvent.click(screen.getByRole('tab', { name: 'kind_all' }));
    expect(screen.getByText('Document checked')).toBeTruthy();
    expect(window.location.search).toContain('act.f.kind=all');
  });

  it('folds a run of checks into one row that opens to its documents', async () => {
    service.activity = feed([check('a'), check('b'), check('c')]);
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => screen.getByText('run_documents:3'));
    expect(screen.queryByText('doc-b.md')).toBeNull();
    fireEvent.click(document.querySelector('[data-activity-run-toggle]')!);
    expect(screen.getByText('doc-b.md')).toBeTruthy();
  });

  it('searches every column, a run’s documents too', async () => {
    service.activity = feed([check('a'), check('b', 'special.md'), check('c'), comment('x')]);
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => screen.getByText('Commented'));
    fireEvent.click(screen.getByRole('tab', { name: 'kind_all' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'special' } });
    expect(screen.queryByText('Commented')).toBeNull();
    expect(screen.getByText('run_documents:3')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing-like-it' } });
    expect(screen.getByText('no_matches')).toBeTruthy();
  });

  it('says nothing is recorded yet, and where records come from', async () => {
    service.activity = feed([]);
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => screen.getByText('empty_title'));
    expect(screen.getByText('empty_body')).toBeTruthy();
  });

  it('says the feed could not be read, with the gear’s words, and tries again', async () => {
    service.activity = feed(new Error('ingest is down'));
    render(<ActivityScreen projectId="p1" t={t} language="en" />);
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toContain('ingest is down');
    expect(screen.queryByText('empty_title')).toBeNull();
    service.activity = feed([comment('x')]);
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => screen.getByText('Commented'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
