import { describe, expect, it } from 'vitest';
import { matchesQuery, type ConnectionRow } from './useConnectionList';
import { type ConnectionDto } from '@constructor-studio/mfe-shared';

/**
 * The filter is the only logic in the hook worth isolating: the two reads
 * around it are `useApiQuery` calls with nothing of ours in them, and the
 * matching rule is what a member notices when it is wrong.
 */
function row(over: Partial<ConnectionDto>, providerName = 'GitHub'): ConnectionRow {
  const connection: ConnectionDto = {
    id: 'c-1',
    owner_tenant_id: 'org-1',
    provider: 'gh',
    label: 'Platform GitHub',
    account: 'constructorfabric',
    base_url: 'https://api.github.com',
    scope: 'organization',
    secret_ref: 'ref',
    created_at_epoch_secs: 1_700_000_000,
    ...over,
  };
  return { connection, providerName };
}

describe('toolbar search', () => {
  it('keeps every row when nothing is typed', () => {
    expect(matchesQuery(row({}), '   ')).toBe(true);
  });

  it('matches the connection name', () => {
    expect(matchesQuery(row({}), 'platform')).toBe(true);
  });

  it('matches the account, which is what tells two GitHub rows apart', () => {
    expect(matchesQuery(row({ label: 'A' }), 'constructorfabric')).toBe(true);
  });

  it('matches the provider by its display name', () => {
    expect(matchesQuery(row({ label: 'A', account: 'b' }), 'hub')).toBe(true);
  });

  it('matches the provider by its wire key', () => {
    expect(matchesQuery(row({ label: 'A', account: 'b' }), 'gh')).toBe(true);
  });

  it('drops a row nothing in it matches', () => {
    expect(matchesQuery(row({}), 'gitlab')).toBe(false);
  });
});
