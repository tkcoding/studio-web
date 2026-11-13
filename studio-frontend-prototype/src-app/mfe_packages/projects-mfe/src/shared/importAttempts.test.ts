import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordRequests, requestedInTab } from './importAttempts';

describe('the repositories this tab asked a sync for', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps each project its own repositories, once each', () => {
    recordRequests('p-1', ['acme/api', 'acme/web']);
    recordRequests('p-1', ['acme/web', 'acme/docs']);
    recordRequests('p-2', ['lab/tool']);

    expect(requestedInTab('p-1')).toEqual(['acme/api', 'acme/web', 'acme/docs']);
    expect(requestedInTab('p-2')).toEqual(['lab/tool']);
    expect(requestedInTab('p-3')).toEqual([]);
  });

  it('reads nothing from a record it cannot parse', () => {
    window.sessionStorage.setItem('projects/artifact-sync/requested-repos', '{not json');

    expect(requestedInTab('p-1')).toEqual([]);
  });

  it('does not throw when the session storage is denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(() => recordRequests('p-1', ['acme/api'])).not.toThrow();
    expect(requestedInTab('p-1')).toEqual([]);
  });
});
