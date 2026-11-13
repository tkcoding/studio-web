import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '@frontx-test-utils/stubResizeObserver';
import en from './i18n/en.json';

const { headerProps, queryResult, org } = vi.hoisted(() => ({
  headerProps: { current: null as { total?: number; projectTotal?: number } | null },
  queryResult: { current: {} as Record<string, unknown> },
  org: { current: { id: 'org-1', name: 'Fabric' } as { id: string; name: string } | null },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => ({ getWorkspaces: vi.fn(() => ({})) }) },
  useApiQuery: () => queryResult.current,
  useFormatters: () => ({ formatRelative: (value: unknown) => String(value) }),
  useMfeBridge: () => null,
  useSharedProperty: () => null,
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganization: () => ({ org: org.current, loading: false }),
}));

vi.mock('../../i18n', async () => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  const text = dictionaryText((await import('./i18n/en.json')).default);
  return {
    useWorkspacesScreenTranslations: () => ({ isLoaded: true, error: null }),
    useWorkspacesText: () => text,
  };
});

vi.mock('../../actions/workspaceActions', () => ({ requestWorkspace: vi.fn() }));

vi.mock('./components/WorkspacesHeader', () => ({
  WorkspacesHeader: (props: { total?: number; projectTotal?: number }) => {
    headerProps.current = props;
    return null;
  },
}));

import { requestWorkspace } from '../../actions/workspaceActions';
import { WorkspacesScreen } from './WorkspacesScreen';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `w${index}`,
    name: index === 0 ? 'Platform' : `Workspace ${index}`,
    child_count: 1,
  }));

const shownRows = () => screen.queryAllByText(/^(Platform|Workspace \d+)$/).length;
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const search = () => screen.queryByPlaceholderText(en.search_placeholder);
const typeSearch = (value: string) => fireEvent.change(search()!, { target: { value } });

describe('WorkspacesScreen', () => {
  beforeEach(() => {
    stubResizeObserver();
    org.current = { id: 'org-1', name: 'Fabric' };
    queryResult.current = {
      data: { items: rows(10) },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    headerProps.current = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows every workspace when nothing is searched for', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));
    expect(headerProps.current?.total).toBe(10);
  });

  it('narrows the rows but keeps the organization count when a search runs', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    typeSearch('Platform');

    await waitFor(() => expect(shownRows()).toBe(1));
    expect(headerProps.current?.total).toBe(10);
  });

  it('counts the rows a search found under the list', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(screen.getByText('10 workspaces')).toBeTruthy());

    typeSearch('Platform');

    await waitFor(() => expect(screen.getByText('1 workspace')).toBeTruthy());
  });

  it('shows 25 rows to a page', async () => {
    queryResult.current = { ...queryResult.current, data: { items: rows(30) } };
    render(<WorkspacesScreen />);

    await waitFor(() => expect(shownRows()).toBe(25));
    expect(screen.getByText('30 workspaces')).toBeTruthy();
  });

  it('shows the rest on the second page, under the same count', async () => {
    queryResult.current = { ...queryResult.current, data: { items: rows(30) } };
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(25));

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));

    await waitFor(() => expect(shownRows()).toBe(5));
    expect(screen.getByText('Workspace 29')).toBeTruthy();
    expect(screen.getByText('30 workspaces')).toBeTruthy();
  });

  it('finds a workspace whatever the case and the spaces around the search', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    typeSearch('  platform ');

    await waitFor(() => expect(shownRows()).toBe(1));
    expect(screen.getByText('Platform')).toBeTruthy();
  });

  it('says nothing matched, and Clear search brings the rows back', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    typeSearch('nothing like it');
    await waitFor(() => expect(screen.getByText(en.empty_search)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: en.clear_search }));
    await waitFor(() => expect(shownRows()).toBe(10));
  });

  it('says the organization has no workspaces yet, with no search to clear', async () => {
    queryResult.current = { ...queryResult.current, data: { items: [] } };
    render(<WorkspacesScreen />);

    await waitFor(() => expect(screen.getByText(en.empty_title)).toBeTruthy());
    expect(screen.getByText(en.empty_hint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.clear_search })).toBeNull();
  });

  it('opens a workspace clicked anywhere on its row', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    fireEvent.click(rowOf('Platform').querySelector('td:last-child')!);
    expect(requestWorkspace).toHaveBeenCalledWith(null, { id: 'w0', name: 'Platform' }, 'org-1');
  });

  it('opens a workspace with Enter on its row', async () => {
    render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    fireEvent.keyDown(rowOf('Platform'), { key: 'Enter' });
    expect(requestWorkspace).toHaveBeenCalledWith(null, { id: 'w0', name: 'Platform' }, 'org-1');
  });

  it('shows a workspace created since, without a reload', async () => {
    const { rerender } = render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    queryResult.current = { ...queryResult.current, data: { items: rows(11) } };
    rerender(<WorkspacesScreen />);

    await waitFor(() => expect(shownRows()).toBe(11));
  });

  it("shows the other organization's own rows and count when the organization changes", async () => {
    const { rerender } = render(<WorkspacesScreen />);
    await waitFor(() => expect(shownRows()).toBe(10));

    org.current = { id: 'org-2', name: 'Lab' };
    queryResult.current = { ...queryResult.current, data: { items: rows(3) } };
    rerender(<WorkspacesScreen />);

    await waitFor(() => expect(shownRows()).toBe(3));
    expect(screen.getByText('3 workspaces')).toBeTruthy();
  });

  it('keeps the rows and offers to read again when a read fails', async () => {
    queryResult.current = { ...queryResult.current, isError: true };
    render(<WorkspacesScreen />);

    await waitFor(() => expect(shownRows()).toBe(10));
    expect(screen.getByRole('alert').textContent).toBe(en.error_title);

    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(queryResult.current.refetch).toHaveBeenCalled();
  });

  it('shows only the failure, with no list, when the first read fails', () => {
    queryResult.current = { ...queryResult.current, data: undefined, isError: true };
    render(<WorkspacesScreen />);

    expect(screen.getByRole('alert').textContent).toBe(en.error_title);
    expect(search()).toBeNull();
  });
});
