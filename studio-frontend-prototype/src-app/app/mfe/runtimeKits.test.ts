/**
 * The runtime kits' lifecycle (issue #1006) on a registry that records what
 * is registered: which scopes have settled, what an uninstall and an upgrade
 * unload, and that an upgraded remote is loaded afresh. The same packages on
 * a real registry are in generatedBootstrap.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MfeRegistry } from '@gears-frontx/react';
import type { KitMfeManifest } from '@/app/api/InstalledKitsApiService';

const { forgetLoadedRemote } = vi.hoisted(() => ({ forgetLoadedRemote: vi.fn(() => true) }));

vi.mock('./remoteCache', () => ({ forgetLoadedRemote }));
vi.mock('./bootstrap', () => ({
  mfeStylesheetHrefs: () => [],
  registerMfePackage: async (registry: FakeRegistry, config: { extensions?: Ext[] }) => {
    for (const ext of config.extensions ?? []) {
      if (ext.id.includes('broken')) throw new Error('validation failed');
      await registry.registerExtension(ext);
    }
  },
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prewarmShadowStyles: () => undefined,
}));

import { RuntimeKits, runtimeScopeKey } from './runtimeKits';

const SCREEN = 'gts.frontx.mfes.ext.domain.v1~frontx.screensets.layout.screen.v1';
const SLOT = 'gts.frontx.mfes.ext.domain.v1~constructor_studio.shell.slots.screen_panels.v1';
const ORIGIN = 'https://studio.example';
const MF = 'gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1~';

type Ext = { id: string; domain: string; entry: string; presentation?: Record<string, unknown> };

class FakeRegistry {
  readonly extensions = new Map<string, Ext>();
  readonly unregistered: string[] = [];
  readonly typeSystem = { getSchema: () => undefined };
  getRegisteredPackages = () => [];
  getDomain = (id: string) => (id === SCREEN || id === SLOT ? { id } : undefined);
  getExtension = (id: string) => this.extensions.get(id);
  getExtensionsForDomain = (domain: string) => [...this.extensions.values()].filter((ext) => ext.domain === domain);
  registerExtension = async (ext: Ext) => {
    this.extensions.set(ext.id, ext);
  };
  unregisterExtension = async (id: string) => {
    this.extensions.delete(id);
    this.unregistered.push(id);
  };
}

/** A kit package listing one screen at `/<kit>` and, with `panel`, one panel. */
function pkg(kit: string, version: string, opts: { panel?: boolean; domain?: string; basePath?: string; broken?: boolean } = {}): KitMfeManifest {
  const ns = kit.replace(/-/g, '_');
  const entry = `${MF}example.${ns}.mfe.main.v1`;
  const extensions: Ext[] = [
    {
      id: `gts.frontx.mfes.ext.extension.v1~example.${ns}.screens.${opts.broken ? 'broken' : 'main'}.v1`,
      domain: opts.domain ?? SCREEN,
      entry,
      presentation: { label: `${kit} screen`, route: `/${kit}`, level: 'project' },
    },
  ];
  if (opts.panel) {
    extensions.push({
      id: `gts.frontx.mfes.ext.extension.v1~example.${ns}.slots.panel.v1`,
      domain: SLOT,
      entry,
      presentation: { label: `${kit} panel`, screen: '/projects/overview' },
    });
  }
  return {
    kit_slug: kit,
    version,
    package: 'main',
    base_path: opts.basePath ?? `/cf/studio-kits/v1/kits/${kit}/${version}/mfe/g/main/`,
    config: {
      manifest: { id: `gts.frontx.mfes.mfe.mf_manifest.v1~example.${ns}.mfe.manifest.v1`, metaData: { publicPath: 'auto' } },
      entries: [{ id: entry, actions: [], domainActions: [], exposedModule: './lifecycle', exposeAssets: { js: { sync: [], async: [] }, css: { sync: [], async: [] } } }],
      extensions,
    },
    error: null,
  };
}

let registry: FakeRegistry;
let kits: RuntimeKits;
let notified: number;

beforeEach(() => {
  registry = new FakeRegistry();
  kits = new RuntimeKits(registry as unknown as MfeRegistry);
  notified = 0;
  kits.subscribe(() => {
    notified += 1;
  });
  forgetLoadedRemote.mockClear();
});

const ids = () => [...registry.extensions.keys()].sort();

describe('runtimeScopeKey', () => {
  it('names the open project before the organization, and nothing without either', () => {
    expect(runtimeScopeKey({ project: 'p', org: 'o' })).toBe('project:p');
    expect(runtimeScopeKey({ org: 'o' })).toBe('organization:o');
    expect(runtimeScopeKey({})).toBeNull();
  });
});

describe('RuntimeKits: a scope settles', () => {
  it('is unsettled until begun and settled, and only for that scope', () => {
    expect(kits.isSettled('project:p1')).toBe(false);
    kits.begin('project:p1');
    expect(kits.isSettled('project:p1')).toBe(false);
    kits.settle('project:p1');
    expect(kits.isSettled('project:p1')).toBe(true);
    expect(kits.isSettled('project:p2')).toBe(false);
    expect(notified).toBe(2);
  });

  it('ignores the settling of a scope the person has left', () => {
    kits.begin('project:p1');
    kits.begin('project:p2');
    kits.settle('project:p1');
    expect(kits.isSettled('project:p1')).toBe(false);
    expect(kits.isSettled('project:p2')).toBe(false);
  });

  it('waits again when the same scope begins again (its kits changed)', () => {
    kits.begin('project:p1');
    kits.settle('project:p1');
    kits.begin('project:p1');
    expect(kits.isSettled('project:p1')).toBe(false);
  });
});

describe('RuntimeKits: registration, removal and upgrade', () => {
  it('registers a package, tells the listeners once, and moves the revision', async () => {
    const before = kits.revision();
    await kits.sync([pkg('alpha', '1.0.0', { panel: true })], ORIGIN);
    expect(ids()).toEqual([
      'gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1',
      'gts.frontx.mfes.ext.extension.v1~example.alpha.slots.panel.v1',
    ]);
    expect(kits.revision()).toBe(before + 1);
    expect(notified).toBe(1);
    // Shown only where its own kit is installed, whatever the bundle says.
    expect(registry.getExtensionsForDomain(SLOT)[0].presentation?.kit).toBe('alpha');
  });

  it('does nothing for a package listed again at the same revision', async () => {
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    const revision = kits.revision();
    notified = 0;
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    expect(kits.revision()).toBe(revision);
    expect(notified).toBe(0);
    expect(registry.unregistered).toEqual([]);
  });

  it('unregisters a package that is no longer listed: the kit was uninstalled', async () => {
    await kits.sync([pkg('alpha', '1.0.0', { panel: true }), pkg('beta', '2.0.0')], ORIGIN);
    const revision = kits.revision();
    await kits.sync([pkg('beta', '2.0.0')], ORIGIN);
    expect(ids()).toEqual(['gts.frontx.mfes.ext.extension.v1~example.beta.screens.main.v1']);
    expect(registry.unregistered).toHaveLength(2);
    expect(kits.revision()).toBe(revision + 1);
    // What "not available here" can still name.
    expect(kits.knownScreen('alpha')).toEqual({ kit: 'alpha', label: 'alpha screen' });
    expect(kits.isRuntime('gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1')).toBe(false);
  });

  it('drops the tile of a package that is no longer listed', async () => {
    await kits.sync([{ ...pkg('alpha', '1.0.0'), config: null, error: 'not built' }], ORIGIN);
    expect(kits.failures()).toHaveLength(1);
    await kits.sync([], ORIGIN);
    expect(kits.failures()).toEqual([]);
  });

  it('replaces an upgraded package, and forgets the remote the page loaded for it', async () => {
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    expect(forgetLoadedRemote).not.toHaveBeenCalled();
    await kits.sync([pkg('alpha', '1.1.0')], ORIGIN);
    expect(registry.unregistered).toEqual(['gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1']);
    expect(forgetLoadedRemote).toHaveBeenCalledWith('gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1');
    expect(ids()).toEqual(['gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1']);
    const screen = registry.getExtensionsForDomain(SCREEN)[0];
    expect(screen).toBeDefined();
  });

  it('takes the same version at another base path for a new revision (a re-pinned commit)', async () => {
    await kits.sync([pkg('alpha', '1.0.0', { basePath: '/cf/a/' })], ORIGIN);
    await kits.sync([pkg('alpha', '1.0.0', { basePath: '/cf/b/' })], ORIGIN);
    expect(forgetLoadedRemote).toHaveBeenCalledTimes(1);
    expect(registry.unregistered).toHaveLength(1);
  });

  it('reuses what the page loaded when a kit comes back at the same revision', async () => {
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    await kits.sync([], ORIGIN);
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    expect(forgetLoadedRemote).not.toHaveBeenCalled();
    expect(ids()).toHaveLength(1);
  });

  it('keeps the old version when the new one is refused, and says why', async () => {
    await kits.sync([pkg('alpha', '1.0.0')], ORIGIN);
    await kits.sync([pkg('alpha', '1.1.0', { domain: 'gts.frontx.mfes.ext.domain.v1~example.alpha.own.slot.v1' })], ORIGIN);
    expect(ids()).toEqual(['gts.frontx.mfes.ext.extension.v1~example.alpha.screens.main.v1']);
    expect(kits.failures()[0].reason).toContain('not a slot the shell has');
  });

  it('takes out the half of a package that registered when the rest did not', async () => {
    const half = pkg('alpha', '1.0.0', { panel: true });
    const config = half.config as { extensions: Ext[] };
    config.extensions = [config.extensions[1], { ...config.extensions[0], id: config.extensions[0].id.replace('main', 'broken') }];
    await kits.sync([half], ORIGIN);
    expect(ids()).toEqual([]);
    expect(kits.failures()[0].reason).toBe('validation failed');
  });

  it('runs syncs one after another, the last list winning', async () => {
    await Promise.all([
      kits.sync([pkg('alpha', '1.0.0')], ORIGIN),
      kits.sync([pkg('beta', '1.0.0')], ORIGIN),
    ]);
    expect(ids()).toEqual(['gts.frontx.mfes.ext.extension.v1~example.beta.screens.main.v1']);
  });
});
