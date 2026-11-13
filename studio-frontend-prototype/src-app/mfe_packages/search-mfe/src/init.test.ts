import { describe, expect, it, vi } from 'vitest';

const build = vi.fn(() => ({ id: 'search-mfe-app' }));
const use = vi.fn();
const createFrontX = vi.fn(() => ({ use }));
const register = vi.fn();
const initialize = vi.fn();
const queryCacheShared = vi.fn(() => 'query-cache-shared-plugin');
const i18n = vi.fn(() => 'i18n-plugin');
use.mockImplementation(() => ({ use, build }));

vi.mock('@gears-frontx/react', () => ({
  createFrontX,
  apiRegistry: { register, initialize },
  i18n,
  queryCacheShared,
}));

const { authShared, AccountsApiService } = vi.hoisted(() => ({
  authShared: vi.fn(() => 'auth-shared-plugin'),
  AccountsApiService: class AccountsApiService {},
}));
vi.mock('@constructor-studio/mfe-shared', () => ({ authShared, AccountsApiService }));
vi.mock('./api/SearchApiService', () => ({ SearchApiService: class SearchApiService {} }));

describe('search-mfe init', () => {
  it('registers the services it reads and builds the app with the shared session', async () => {
    const module = await import('./init');
    expect(register.mock.calls.map(([service]) => (service as { name: string }).name)).toEqual([
      'AccountsApiService',
      'SearchApiService',
    ]);
    expect(initialize).toHaveBeenCalledTimes(1);
    // authShared last: without it every read goes out with no bearer (401).
    expect(use.mock.calls).toEqual([['i18n-plugin'], ['query-cache-shared-plugin'], ['auth-shared-plugin']]);
    expect(module.mfeApp).toEqual({ id: 'search-mfe-app' });
  });
});
