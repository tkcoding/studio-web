import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '@frontx-test-utils/stubResizeObserver';
import type { DataGridLoadContext } from '@gears-frontx/ui-kit';
import type { ConnectionDto } from '@constructor-studio/mfe-shared';
import type { ConnectionListView } from '../../shared/useConnectionList';
import type { ConnectionRow } from '../../model/connection';
import en from './i18n/en.json';

const { list, org } = vi.hoisted(() => ({
  list: { current: null as ConnectionListView | null },
  org: { current: { id: 'org-1', name: 'Fabric' } as { id: string; name: string } | null },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useMfeBridge: () => null,
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganization: () => ({ org: org.current, loading: false }),
}));
vi.mock('../../i18n', async () => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  const text = dictionaryText((await import('./i18n/en.json')).default);
  return {
    useConnectionListScreenTranslations: () => ({ isLoaded: true, error: null }),
    useConnectionListText: () => text,
  };
});
vi.mock('../../shared/useConnectionList', () => ({ useConnectionList: () => list.current }));
// The health cell reads the network; the rows are what this test is about.
vi.mock('./components/HealthInline', () => ({ HealthInline: () => null }));

import { ConnectionListScreen } from './ConnectionListScreen';

const row = (id: string, label: string): ConnectionRow => ({
  id,
  connection: {
    id,
    owner_tenant_id: 'org-1',
    provider: 'github',
    label,
    account: 'constructorfabric',
    base_url: 'https://api.github.com',
    scope: 'organization',
    secret_ref: 'ref',
    created_at_epoch_secs: 1_700_000_000,
  } as ConnectionDto,
  providerName: 'GitHub',
});

const ROWS = [row('c-1', 'Platform GitHub'), row('c-2', 'Docs GitHub')];

function view(over: Partial<ConnectionListView> = {}): ConnectionListView {
  const rows = over.total === 0 ? [] : ROWS;
  return {
    loading: false,
    failed: false,
    org: { id: 'org-1', name: 'Fabric' },
    total: rows.length,
    found: rows.length,
    retry: vi.fn(),
    load: async (context: DataGridLoadContext) => {
      const text: string = context.filters?.textSearch?.value ?? '';
      const shown = rows.filter((row) => row.connection.label.includes(text));
      return { results: shown, total: shown.length };
    },
    rowsBridge: <></>,
    ...over,
  };
}

const search = () => screen.queryByPlaceholderText(en.search_placeholder);

describe('ConnectionListScreen', () => {
  beforeEach(() => {
    stubResizeObserver();
    org.current = { id: 'org-1', name: 'Fabric' };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists the rows and counts what was found under them', async () => {
    list.current = view();
    render(<ConnectionListScreen />);

    await waitFor(() => expect(screen.getByText('Platform GitHub')).toBeTruthy());
    expect(screen.getByText('2 connections')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the rows and offers to read again when a read fails', async () => {
    list.current = view({ failed: true });
    render(<ConnectionListScreen />);

    await waitFor(() => expect(screen.getByText('Platform GitHub')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(en.error_title);

    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(list.current.retry).toHaveBeenCalledTimes(1);
  });

  it('shows only the failure, with no list, when the first read fails', () => {
    list.current = view({ failed: true, total: 0, found: null });
    render(<ConnectionListScreen />);

    expect(screen.getByRole('alert').textContent).toBe(en.error_title);
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy();
    expect(search()).toBeNull();
  });

  it('says a search matched nothing, not that there are no connections, and clears it', async () => {
    list.current = view();
    render(<ConnectionListScreen />);
    await waitFor(() => expect(screen.getByText('Platform GitHub')).toBeTruthy());

    fireEvent.change(search()!, { target: { value: 'nothing like it' } });
    await waitFor(() => expect(screen.getByText(en.empty_no_match)).toBeTruthy());
    expect(screen.queryByText(en.empty_title)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: en.clear_search }));
    await waitFor(() => expect(screen.getByText('Platform GitHub')).toBeTruthy());
  });

  it('says the organization has no connections yet, and how to add one', async () => {
    list.current = view({ total: 0 });
    render(<ConnectionListScreen />);

    await waitFor(() => expect(screen.getByText(en.empty_title)).toBeTruthy());
    expect(screen.getByText(en.empty_hint)).toBeTruthy();
  });

  it('says no organization is in scope when there is none', async () => {
    org.current = null;
    list.current = view({ total: 0, org: null });
    render(<ConnectionListScreen />);

    await waitFor(() => expect(screen.getByText(en.empty_no_org)).toBeTruthy());
    expect(screen.queryByText(en.empty_hint)).toBeNull();
  });

  it('shows neither the list nor a failure while the rows load', () => {
    list.current = view({ loading: true });
    render(<ConnectionListScreen />);

    expect(search()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
