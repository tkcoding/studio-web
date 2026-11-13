import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TableProps = {
  rows: { id: string; name: string }[];
  total: number;
  onRename: (row: unknown) => void;
  onDelete: (row: unknown) => void;
  health: (row: { id: string }) => unknown;
  stuckDays: number;
};

const { tableProps, queryResult, overviewResult, org, rename, remove, dialogs } = vi.hoisted(() => ({
  tableProps: { current: null as TableProps | null },
  queryResult: { current: {} as Record<string, unknown> },
  overviewResult: { current: {} as Record<string, unknown> },
  org: { current: { id: 'org-1', name: 'Fabric' } as { id: string; name: string } | null },
  rename: vi.fn(),
  remove: vi.fn(),
  dialogs: {
    name: null as null | { open: boolean; onSave: (n: string) => Promise<unknown> },
    confirm: null as null | { open: boolean; onConfirm: () => Promise<unknown> },
  },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({
      getWorkspaces: vi.fn(() => ({ kind: 'workspaces' })),
      overview: vi.fn(() => ({ kind: 'overview' })),
      renameTenant: (id: string) => ({ fetch: (body: unknown) => rename(id, body) }),
      deleteTenant: (id: string) => ({ fetch: () => remove(id) }),
    }),
  },
  useApiQuery: (descriptor: { kind: string }) =>
    descriptor.kind === 'overview' ? overviewResult.current : queryResult.current,
  useMfeBridge: () => null,
  useSharedProperty: () => null,
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganization: () => ({ org: org.current, loading: false }),
}));

vi.mock('../../i18n', () => ({
  useWorkspacesScreenTranslations: () => ({ isLoaded: true, error: null }),
  useWorkspacesText: () => (key: string) => key,
}));

vi.mock('./components/WorkspacesToolbar', () => ({
  WorkspacesToolbar: ({
    onQueryChange,
    onManagedChange,
  }: {
    onQueryChange: (value: string) => void;
    onManagedChange?: (value: string) => void;
  }) => (
    <>
      <input aria-label="search" onChange={(event) => onQueryChange(event.currentTarget.value)} />
      <button onClick={() => onManagedChange?.('self')}>self</button>
    </>
  ),
}));

vi.mock('../../components/dialogs', () => ({
  NameDialog: (props: { open: boolean; onSave: (n: string) => Promise<unknown> }) => {
    dialogs.name = props;
    return null;
  },
  ConfirmDialog: (props: { open: boolean; onConfirm: () => Promise<unknown> }) => {
    dialogs.confirm = props;
    return null;
  },
}));

// Stubbed to read what the screen hands it: the caption's own wording is the
// table's business and is covered in WorkspacesTable.test.tsx.
vi.mock('./components/WorkspacesTable', () => ({
  WorkspacesTable: (props: TableProps) => {
    tableProps.current = props;
    return <div data-testid="table" />;
  },
}));

import { WorkspacesScreen } from './WorkspacesScreen';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `w${index}`,
    name: index === 0 ? 'Platform' : `Workspace ${index}`,
    child_count: 1,
    self_managed: index === 1,
  }));

describe('WorkspacesScreen', () => {
  beforeEach(() => {
    org.current = { id: 'org-1', name: 'Fabric' };
    queryResult.current = {
      data: { items: rows(10) },
      isLoading: false,
      isError: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
    overviewResult.current = {};
    tableProps.current = null;
    dialogs.name = null;
    dialogs.confirm = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('hands the table every workspace when nothing is searched for', () => {
    render(<WorkspacesScreen />);
    expect(tableProps.current?.rows).toHaveLength(10);
    expect(tableProps.current?.total).toBe(10);
  });

  // The regression: `total` followed the filtered rows, so the caption said
  // "1-2 of 2" and stopped naming the organization's real count.
  it('narrows the rows but keeps the organization count when a search runs', () => {
    render(<WorkspacesScreen />);

    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'Platform' } });

    expect(tableProps.current?.rows).toHaveLength(1);
    expect(tableProps.current?.total).toBe(10);
  });

  it('keeps only the self-managed workspaces when that filter is picked', () => {
    render(<WorkspacesScreen />);
    fireEvent.click(screen.getByText('self'));
    expect(tableProps.current?.rows.map((r) => r.id)).toEqual(['w1']);
  });

  it("joins the overview's health to each workspace by id, and its stuck threshold", () => {
    overviewResult.current = { data: { stuck_days: 5, workspaces: [{ id: 'w2', projects: [] }] } };
    render(<WorkspacesScreen />);
    expect(tableProps.current?.health({ id: 'w2' })).toEqual({ id: 'w2', projects: [] });
    expect(tableProps.current?.health({ id: 'w3' })).toBeUndefined();
    expect(tableProps.current?.stuckDays).toBe(5);
  });

  it('without the overview the health is unknown, not zero', () => {
    render(<WorkspacesScreen />);
    expect(tableProps.current?.health({ id: 'w2' })).toBeUndefined();
    expect(tableProps.current?.stuckDays).toBe(7);
  });

  it('renames a workspace through the account system and reads the list again', async () => {
    render(<WorkspacesScreen />);
    act(() => tableProps.current?.onRename({ id: 'w3', name: 'Workspace 3' }));
    expect(dialogs.name?.open).toBe(true);
    await act(async () => {
      await dialogs.name?.onSave('Renamed');
    });
    expect(rename).toHaveBeenCalledWith('w3', { name: 'Renamed' });
    expect(queryResult.current.refetch).toHaveBeenCalled();
  });

  it('deletes a workspace only after the confirmation, and passes a refusal on', async () => {
    remove.mockRejectedValueOnce(new Error('has projects'));
    render(<WorkspacesScreen />);
    expect(dialogs.confirm?.open).toBe(false);
    act(() => tableProps.current?.onDelete({ id: 'w4', name: 'Workspace 4' }));
    expect(dialogs.confirm?.open).toBe(true);
    await expect(dialogs.confirm?.onConfirm()).rejects.toThrow('has projects');
    expect(remove).toHaveBeenCalledWith('w4');
  });
});
