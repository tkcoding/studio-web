import { afterEach, describe, expect, it, vi } from 'vitest';

const build = vi.fn();
const use = vi.fn();
const createFrontX = vi.fn(() => ({
  use,
}));
const registerSlice = vi.fn();
const register = vi.fn();
const initialize = vi.fn();
const effects = vi.fn(() => 'effects-plugin');
const queryCacheShared = vi.fn(() => 'query-cache-shared-plugin');
const mock = vi.fn(() => 'mock-plugin');
const i18n = vi.fn(() => 'i18n-plugin');

vi.mock('@gears-frontx/react', () => ({
  createFrontX,
  registerSlice,
  apiRegistry: {
    register,
    initialize,
  },
  effects,
  i18n,
  mock,
  queryCacheShared,
}));

vi.mock('./api/_BlankApiService', () => ({
  _BlankApiService: class BlankApiService {
    static {
      void 0;
    }
  },
}));

const { authShared } = vi.hoisted(() => ({ authShared: vi.fn(() => 'auth-shared-plugin') }));
vi.mock('@constructor-studio/mfe-shared', () => ({ authShared }));

vi.mock('./api/KitsApiService', () => ({
  KitsApiService: class KitsApiService {},
  ConnectionsApiService: class ConnectionsApiService {},
}));

vi.mock('./slices/homeSlice', () => ({
  homeSlice: { name: '_blank/home' },
}));

vi.mock('./effects/homeEffects', () => ({
  initHomeEffects: vi.fn(),
}));

describe('_blank-mfe init', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    use.mockImplementation(() => ({ use, build }));
    build.mockReturnValue({ id: 'blank-mfe-app' });
  });

  it('registers services before build and registers slices after build', async () => {
    use.mockImplementation(() => ({ use, build }));
    const expectedApp = { id: 'blank-mfe-app' };
    build.mockReturnValue(expectedApp);

    const { initHomeEffects } = await import('./effects/homeEffects');
    const module = await import('./init');

    // The template's service, the kit library's catalogue, and the
    // organization's connections (a kit from a repository).
    expect(register).toHaveBeenCalledTimes(3);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(createFrontX).toHaveBeenCalledTimes(1);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(queryCacheShared).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    // The home screen reads its text through the framework's i18n.
    expect(i18n).toHaveBeenCalledTimes(1);
    expect(use.mock.calls).toEqual(expect.arrayContaining([
      ['effects-plugin'],
      ['i18n-plugin'],
      ['query-cache-shared-plugin'],
      ['mock-plugin'],
      // Without it every request goes out with no bearer (401).
      ['auth-shared-plugin'],
    ]));
    expect(build).toHaveBeenCalledTimes(1);
    expect(registerSlice).toHaveBeenCalledWith({ name: '_blank/home' }, initHomeEffects);
    expect(module.mfeApp).toBe(expectedApp);
  });
});
