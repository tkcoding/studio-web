import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '@frontx-test-utils/stubResizeObserver';
import type { Tenant } from '@constructor-studio/mfe-shared';
import en from './i18n/en.json';

/** The list's header and grid (DoD `...-workspace-scope-no-workspace`). */

const { scope, bridge, openProjectWizard, requestOpenProject } = vi.hoisted(() => ({
  scope: { current: {} as Record<string, unknown> },
  bridge: { id: 'bridge' },
  openProjectWizard: vi.fn(),
  requestOpenProject: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useMfeBridge: () => bridge,
  useFormatters: () => ({ formatRelative: (value: unknown) => String(value) }),
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganization: () => ({ org: { id: 'org-1', name: 'Acme' }, loading: false, failed: false }),
}));

vi.mock('../../i18n', async (importOriginal) => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  const text = dictionaryText((await import('./i18n/en.json')).default);
  return {
    ...(await importOriginal<typeof import('../../i18n')>()),
    useProjectListText: () => text,
    useProjectListScreenTranslations: () => ({ isLoaded: true, error: null }),
  };
});

vi.mock('../../shared/workspaceProjects', () => ({
  WorkspaceProjectsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkspaceProjects: () => scope.current,
}));
vi.mock('../../shared/useProjectConfig', () => ({
  useProjectConfig: () => ({ config: null, loading: false, unset: true, failed: false }),
}));
vi.mock('../../actions/wizardActions', () => ({ openProjectWizard }));
vi.mock('../../actions/projectsActions', () => ({ requestOpenProject }));

import { ProjectListScreen } from './ProjectListScreen';

const ORG = { id: 'org-1', name: 'Acme' };
const WORKSPACE = { id: 'ws-1', name: 'Platform' };

const projects = (count: number): Tenant[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: index === 0 ? 'Billing' : `Project ${index}`,
    status: 'active',
    tenant_type: 'project',
    parent_id: WORKSPACE.id,
    self_managed: false,
    depth: 3,
    child_count: 0,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: new Date(Date.UTC(2026, 7, 1 + index, 9)).toISOString(),
  }));

const inScope = (rows: Tenant[], overrides: Record<string, unknown> = {}) => ({
  org: ORG,
  workspace: WORKSPACE,
  projects: rows,
  loading: false,
  failed: false,
  refetch: vi.fn(),
  ...overrides,
});

const rowNames = () =>
  screen.queryAllByText(/^(Billing|Project \d+)$/).map((name) => name.textContent);
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const shownRows = () => rowNames().length;
const newProject = () => screen.getByRole('button', { name: en.new_project }) as HTMLButtonElement;
const search = () => screen.queryByPlaceholderText(en.search_placeholder) as HTMLInputElement | null;
const typeSearch = (value: string) => fireEvent.change(search()!, { target: { value } });

beforeEach(() => {
  stubResizeObserver();
  scope.current = inScope(projects(10));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the projects list header', () => {
  it('disables New project and says why while no workspace is current', () => {
    scope.current = inScope([], { workspace: null });
    render(<ProjectListScreen />);

    expect(newProject().disabled).toBe(true);
    expect(newProject().getAttribute('title')).toBe(en.empty_no_workspace);
  });

  it('opens the wizard from New project', () => {
    render(<ProjectListScreen />);

    expect(newProject().getAttribute('title')).toBeNull();
    fireEvent.click(newProject());
    expect(openProjectWizard).toHaveBeenCalledWith(bridge);
  });
});

describe('the projects list', () => {
  it('shows every project, the most recently updated first', async () => {
    render(<ProjectListScreen />);

    await waitFor(() => expect(shownRows()).toBe(10));
    expect(rowNames()[0]).toBe('Project 9');
    expect(rowNames()[9]).toBe('Billing');
  });

  it('counts the projects a search found under the list', async () => {
    render(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByText('10 projects')).toBeTruthy());

    typeSearch('Billing');

    await waitFor(() => expect(screen.getByText('1 project')).toBeTruthy());
    expect(shownRows()).toBe(1);
  });

  it('finds a project whatever the case and the spaces around the search', async () => {
    render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    typeSearch('  billing ');

    await waitFor(() => expect(shownRows()).toBe(1));
    expect(rowNames()).toEqual(['Billing']);
  });

  it('says nothing matched, and Clear search brings the rows back', async () => {
    render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    typeSearch('nothing like it');
    await waitFor(() => expect(screen.getByText(en.empty_no_match)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: en.clear_search }));
    await waitFor(() => expect(shownRows()).toBe(10));
    expect(search()?.value).toBe('');
  });

  it('shows 25 rows to a page, and the rest on the second', async () => {
    scope.current = inScope(projects(30));
    render(<ProjectListScreen />);

    await waitFor(() => expect(shownRows()).toBe(25));
    expect(screen.getByText('30 projects')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));

    await waitFor(() => expect(shownRows()).toBe(5));
    expect(rowNames()).toContain('Billing');
  });

  it('says the workspace has no projects yet, with no search to clear', async () => {
    scope.current = inScope([]);
    render(<ProjectListScreen />);

    await waitFor(() => expect(screen.getByText(en.empty_title)).toBeTruthy());
    expect(screen.getByText(en.empty_hint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.clear_search })).toBeNull();
  });

  it('says what is missing when no workspace or no organization is in scope', async () => {
    scope.current = inScope([], { workspace: null });
    const { rerender } = render(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByText(en.empty_no_workspace)).toBeTruthy());

    scope.current = inScope([], { org: null, workspace: null });
    rerender(<ProjectListScreen />);
    await waitFor(() => expect(screen.getByText(en.empty_no_org)).toBeTruthy());
  });

  it('asks the shell to open a project clicked anywhere on its row, with its workspace and the projects beside it', async () => {
    render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    fireEvent.click(rowOf('Billing').querySelector('td:last-child')!);

    const siblings = projects(10).map(({ id, name }) => ({ id, name }));
    expect(requestOpenProject).toHaveBeenCalledWith(
      { id: 'p0', name: 'Billing' },
      siblings,
      bridge,
      WORKSPACE.id
    );
  });

  it('opens a project with Enter on its row', async () => {
    render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    fireEvent.keyDown(rowOf('Billing'), { key: 'Enter' });

    expect(requestOpenProject).toHaveBeenCalledTimes(1);
    expect(requestOpenProject.mock.calls[0][0]).toEqual({ id: 'p0', name: 'Billing' });
  });

  it('asks for nothing while no workspace is in scope', async () => {
    scope.current = inScope(projects(1), { workspace: null });
    render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(1));

    fireEvent.click(rowOf('Billing'));

    expect(requestOpenProject).not.toHaveBeenCalled();
  });

  it("shows another workspace's own rows, with a fresh search, when the workspace changes", async () => {
    const { rerender } = render(<ProjectListScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));
    typeSearch('Billing');
    await waitFor(() => expect(shownRows()).toBe(1));

    scope.current = inScope(projects(3), { workspace: { id: 'ws-2', name: 'Lab' } });
    rerender(<ProjectListScreen />);

    await waitFor(() => expect(shownRows()).toBe(3));
    expect(search()?.value).toBe('');
    expect(screen.getByText('3 projects')).toBeTruthy();
  });

  it('keeps the rows and offers to read again when a read fails', async () => {
    scope.current = inScope(projects(10), { failed: true });
    render(<ProjectListScreen />);

    await waitFor(() => expect(shownRows()).toBe(10));
    expect(screen.getByRole('alert').textContent).toBe(en.error_title);

    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(scope.current.refetch).toHaveBeenCalled();
  });

  it('shows only the failure, with no list, when the first read fails', async () => {
    scope.current = inScope([], { failed: true });
    render(<ProjectListScreen />);

    expect(screen.getByRole('alert').textContent).toBe(en.error_title);
    await expect(
      screen.findByPlaceholderText(en.search_placeholder, {}, { timeout: 200 })
    ).rejects.toThrow();
  });
});
