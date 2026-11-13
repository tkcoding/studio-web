import { describe, expect, it, vi } from 'vitest';

const build = vi.fn(() => ({ id: 'admin-mfe-app' }));
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

const { authShared } = vi.hoisted(() => ({ authShared: vi.fn(() => 'auth-shared-plugin') }));
vi.mock('@constructor-studio/mfe-shared', () => ({
  authShared,
  AccountsApiService: class AccountsApiService {},
  DomainModelApiService: class DomainModelApiService {},
}));

vi.mock('./api/AdminApiService', () => ({
  AdminApiService: class AdminApiService {},
}));

describe('admin-mfe init', () => {
  it('registers its API services before building the app', async () => {
    const module = await import('./init');
    // Admin's own, the accounts reads, and the Studio domain model (the generic level screens).
    expect(register).toHaveBeenCalledTimes(3);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(register.mock.invocationCallOrder[2]).toBeLessThan(build.mock.invocationCallOrder[0]);
    // authShared last: without it every read goes out with no bearer (401).
    expect(use.mock.calls).toEqual([['i18n-plugin'], ['query-cache-shared-plugin'], ['auth-shared-plugin']]);
    expect(module.mfeApp).toEqual({ id: 'admin-mfe-app' });
  });
});
