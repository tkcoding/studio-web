import { describe, expect, it, vi } from 'vitest';

const build = vi.fn(() => ({ id: 'people-mfe-app' }));
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

const { authShared, PeopleApiService, AccountsApiService } = vi.hoisted(() => ({
  authShared: vi.fn(() => 'auth-shared-plugin'),
  PeopleApiService: class PeopleApiService {},
  AccountsApiService: class AccountsApiService {},
}));
vi.mock('@constructor-studio/mfe-shared', () => ({ authShared, PeopleApiService, AccountsApiService }));

describe('people-mfe init', () => {
  it('registers its API services before building the app', async () => {
    const module = await import('./init');
    expect(register.mock.calls.map(([service]) => service)).toEqual([PeopleApiService, AccountsApiService]);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(register.mock.invocationCallOrder[0]).toBeLessThan(build.mock.invocationCallOrder[0]);
    // authShared last: without it every read goes out with no bearer (401).
    expect(use.mock.calls).toEqual([['i18n-plugin'], ['query-cache-shared-plugin'], ['auth-shared-plugin']]);
    expect(module.mfeApp).toEqual({ id: 'people-mfe-app' });
  });
});
