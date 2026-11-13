import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import en from '../i18n/en.json';

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFormatters: () => ({ formatRelative: (value: unknown) => String(value) }),
}));

vi.mock('../../../i18n', async () => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  return { useWorkspacesText: () => dictionaryText(en) };
});

import { WorkspacesTable } from './WorkspacesTable';

const workspaces = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `w${index}`,
    name: `Workspace ${index}`,
    tenant_type: 'workspace',
    status: 'active',
    updated_at: '2026-01-01T00:00:00Z',
  })) as never;

afterEach(cleanup);

describe('the caption under the table', () => {
  it('counts the organization, not the page', () => {
    render(
      <WorkspacesTable rows={workspaces(10)} total={10} empty={null} onOpen={() => undefined} />
    );
    expect(screen.getByText(/of/).textContent).toBe('1–10 of 10 workspaces');
  });

  // The regression this guards: `total` given the filtered rows makes the
  // caption restate the row count back at itself — "1-2 of 2" — instead of
  // saying how many of the organization's workspaces the search matched.
  it('keeps naming the whole when a search narrows the rows', () => {
    render(
      <WorkspacesTable rows={workspaces(2)} total={10} empty={null} onOpen={() => undefined} />
    );
    expect(screen.getByText(/of/).textContent).toBe('1–2 of 10 workspaces');
  });

  it('says none are shown when a search matches nothing', () => {
    render(
      <WorkspacesTable rows={workspaces(0)} total={10} empty="none" onOpen={() => undefined} />
    );
    expect(screen.getByText(/of/).textContent).toBe('0–0 of 10 workspaces');
  });

  it('reads as one workspace when that is all the organization has', () => {
    render(
      <WorkspacesTable rows={workspaces(1)} total={1} empty={null} onOpen={() => undefined} />
    );
    expect(screen.getByText(/of/).textContent).toBe('1–1 of 1 workspace');
  });
});

const health = {
  id: 'w0',
  name: 'Workspace 0',
  spend: 120,
  previous: 100,
  specs_failing: 3,
  stuck: 2,
  quiet_days: 4,
  score: 1,
  projects: [
    { id: 'p1', name: 'api', spend: 80, previous: 50, specs_failing: 3, open_findings: 1, stuck: 2, quiet_days: 1, broken: false, score: 1, reasons: [{ kind: 'stuck' as const, value: 2 }] },
    { id: 'p2', name: 'web', spend: null, previous: null, specs_failing: null, open_findings: null, stuck: 0, quiet_days: null, broken: false, score: 0, reasons: [] },
  ],
};

describe('a workspace row', () => {
  it("shows the overview's numbers and its worst project under the name", () => {
    render(
      <WorkspacesTable
        rows={workspaces(1)}
        total={1}
        empty={null}
        onOpen={() => undefined}
        health={() => health}
        stuckDays={7}
        cash={(v) => `$${v}`}
      />
    );
    const row = document.querySelector('[data-workspace-row="w0"]')!;
    expect(row.textContent).toContain('$120');
    expect(row.textContent).toContain('+20%');
    expect(row.textContent).toContain('4 d');
    expect(row.querySelector('[data-workspace-description]')?.textContent).toMatch(/^api: /);
    expect(screen.getByText('PRs > 7 d')).toBeTruthy();
  });

  it('shows dashes, not zeros, without the overview', () => {
    render(<WorkspacesTable rows={workspaces(1)} total={1} empty={null} onOpen={() => undefined} />);
    const row = document.querySelector('[data-workspace-row="w0"]')!;
    expect(row.textContent).not.toContain('0 d');
    expect(row.querySelectorAll('[title="Not known for this workspace"]').length).toBeGreaterThanOrEqual(5);
    expect(row.querySelector('[data-workspace-expand]')).toBeNull();
  });

  it('folds its projects open with why each is in trouble', () => {
    render(
      <WorkspacesTable rows={workspaces(1)} total={1} empty={null} onOpen={() => undefined} health={() => health} />
    );
    expect(document.querySelector('[data-workspace-projects]')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show its projects'));
    const projects = document.querySelector('[data-workspace-projects="w0"]')!;
    expect(projects.querySelector('[data-workspace-project="p1"]')?.textContent).toContain('api');
    expect(projects.querySelector('[data-workspace-project="p2"]')?.textContent).toContain('nothing wrong');
    fireEvent.click(screen.getByLabelText('Hide its projects'));
    expect(document.querySelector('[data-workspace-projects]')).toBeNull();
  });

  it('offers open, rename and delete', () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <WorkspacesTable rows={workspaces(1)} total={1} empty={null} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
    );
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Rename'));
    fireEvent.click(screen.getByText('Delete'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'w0' }));
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'w0' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'w0' }));
  });
});

describe('the last row', () => {
  it('reads as one workspace when that is all the organization has', () => {
    render(
      <WorkspacesTable rows={workspaces(1)} total={1} empty={null} onOpen={() => undefined} />
    );
    expect(screen.getByText(/of/).textContent).toBe('1–1 of 1 workspace');
  });
});
