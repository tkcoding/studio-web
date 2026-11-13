import { dictionaryText } from '@frontx-test-utils/dictionaryText';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/en.json';
import { connectionColumns } from './connectionColumns';
import type { ConnectionRow } from '../../../model/connection';

/**
 * The row, without any HTTP. The health cell is the one part that would reach
 * the network, so it is stubbed: what this test is for is the other five
 * columns, and above all that the four without a data source render a
 * placeholder rather than a value borrowed from a different fact.
 */
vi.mock('./HealthInline', () => ({
  HealthInline: ({ connectionId }: { connectionId: string }) => (
    <span data-testid={`health-${connectionId}`}>stub</span>
  ),
}));

const ROW: ConnectionRow = {
  id: 'c-1',
  connection: {
    id: 'c-1',
    owner_tenant_id: 'org-1',
    provider: 'github',
    label: 'Platform GitHub',
    account: 'constructorfabric',
    base_url: 'https://api.github.com',
    scope: 'organization',
    secret_ref: 'ref',
    created_at_epoch_secs: 1_700_000_000,
  },
  providerName: 'GitHub',
};

const columns = () => connectionColumns(dictionaryText(en), 'org-1');

function mount(row: ConnectionRow) {
  render(
    <>
      {columns().map(({ id, render: draw }) => (
        <div key={id}>{typeof draw === 'function' ? draw(row) : draw}</div>
      ))}
    </>
  );
}

afterEach(cleanup);

describe('connectionColumns', () => {
  it('names the connection and captions it with the account and the scope', () => {
    mount(ROW);

    expect(screen.getByText('Platform GitHub')).toBeTruthy();
    expect(screen.getByText('constructorfabric · organization')).toBeTruthy();
  });

  it('gives the row its own health cell, scoped to the organization', () => {
    mount(ROW);

    expect(screen.getByTestId('health-c-1')).toBeTruthy();
  });

  it('renders a placeholder in all four columns with no data source', () => {
    mount(ROW);

    // One per gap: available data, projects, last sync, actions.
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it("never shows the record's creation time under Last sync", () => {
    mount(ROW);

    // 1_700_000_000 is 2023 — any rendering of it, relative or absolute, is wrong.
    expect(screen.queryByText(/2023|ago/)).toBeNull();
  });

  it('draws every column the mockup has', () => {
    expect(columns().map((column) => column.label)).toEqual([
      en.col_connection,
      en.col_status,
      en.col_available,
      en.col_projects,
      en.col_last_sync,
      en.col_actions,
    ]);
  });
});
