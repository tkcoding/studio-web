import { describe, expect, it } from 'vitest';
import { matchesSearch } from './matchesSearch';

describe('matchesSearch', () => {
  it('matches every row while nothing but spaces is typed', () => {
    expect(matchesSearch('', 'Billing')).toBe(true);
    expect(matchesSearch('   ', 'Billing')).toBe(true);
  });

  it('matches part of a field, whatever the case and the spaces around the text', () => {
    expect(matchesSearch('  BILL ', 'Billing')).toBe(true);
  });

  it('matches when any one of the fields contains the text', () => {
    expect(matchesSearch('hub', 'Platform', 'GitHub')).toBe(true);
  });

  it('drops a row none of whose fields contains the text', () => {
    expect(matchesSearch('gitlab', 'Platform', 'GitHub')).toBe(false);
  });
});
