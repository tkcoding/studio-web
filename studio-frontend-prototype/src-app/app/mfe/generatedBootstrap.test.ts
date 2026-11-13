/**
 * Bootstraps the GENERATED manifest aggregate on a REAL registry, the way the
 * running shell does. overlayContract.test.ts validates each instance against
 * its schema, which registerExtension does too — but registerExtension checks
 * more (an entry against the domain it is placed in), and a failure there
 * leaves the shell with no screens at all while every unit test is green.
 * Needs a build: public/generated-mfe-manifests.json is its output.
 *
 * Then a kit's screens registered at run time (ADR-0068 phase 5) on the same
 * registry, as the shell does after it knows the installed kits. A runtime
 * builds one FrontX app, so the steps share it and run in order.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createFrontX, gtsPlugin, microfrontends, presets, screenDomain, type MfeRegistry } from '@gears-frontx/react';
import { helloKitManifest, HELLO_KIT_SLUG } from '@frontx-test-utils/helloKitManifest';
import { SHELL_SCHEMAS } from './schemas';
import { bootstrapMFE } from './bootstrap';
import { RuntimeKits, toManifestConfig } from './runtimeKits';
import { resolveLevelMenu, type StudioScreenExtension } from './screenLevels';

const AGGREGATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../public/generated-mfe-manifests.json'
);

for (const schema of SHELL_SCHEMAS) gtsPlugin.registerSchema(schema);

const ORIGIN = 'https://studio.example';
const BUILT_HELLO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../examples/kits/hello-kit/mfe/hello/mfe-manifest.json'
);

describe.skipIf(!existsSync(AGGREGATE)).sequential('the generated manifests on a real registry', () => {
  let registry: MfeRegistry;
  let kits: RuntimeKits;
  let builtIn: StudioScreenExtension[];
  const screens = () => registry.getExtensionsForDomain(screenDomain.id) as StudioScreenExtension[];
  const helloTabs = () => screens().filter((ext) => ext.presentation.route === '/hello-kit');

  it('bootstrap without an error', async () => {
    const body = readFileSync(AGGREGATE, 'utf8');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const app = createFrontX().useAll(presets.full()).use(microfrontends({ typeSystem: gtsPlugin })).build();
    await expect(bootstrapMFE(app)).resolves.toBeUndefined();
    fetch.mockRestore();
    registry = app.mfeRegistry!;
    kits = new RuntimeKits(registry);
    builtIn = screens();
  });

  it('keeps the shell whole when a kit bundle is refused, and says why', async () => {
    const tests = builtIn.find((ext) => ext.presentation.route === '/tests')!;
    const good = helloKitManifest();
    const config = good.config as { extensions: Array<Record<string, unknown>> };
    // A kit that would stand in for a built-in screen, and one that was not built.
    const impostor = {
      ...good,
      kit_slug: 'impostor',
      config: { ...config, extensions: [{ ...config.extensions[0], id: tests.id }] },
    };
    const unbuilt = { ...good, kit_slug: 'unbuilt', config: null, error: 'no mfe-manifest.json: build the bundle first' };
    await kits.sync([impostor, unbuilt], ORIGIN);
    expect(kits.failures().map((f) => f.kit).sort()).toEqual(['impostor', 'unbuilt']);
    expect(kits.failures().find((f) => f.kit === 'unbuilt')?.reason).toContain('build the bundle');
    expect(screens().find((ext) => ext.id === tests.id)?.presentation.kit).toBe(tests.presentation.kit);
    expect(screens().length).toBe(builtIn.length);
    kits.dismiss('impostor/hello');
    kits.dismiss('unbuilt/hello');
  });

  it('registers the demo kit beside the built-in screens, at its level, gated by its kit', async () => {
    await kits.sync([helloKitManifest()], ORIGIN);
    expect(kits.failures()).toEqual([]);
    expect(screens().length).toBe(builtIn.length + 1);
    const [hello] = helloTabs();
    expect(hello.presentation.kit).toBe(HELLO_KIT_SLUG);
    expect(resolveLevelMenu(screens(), 'project').map((ext) => ext.id)).toContain(hello.id);
    // Where the kit's files are: through the gateway, on this origin.
    const config = toManifestConfig(helloKitManifest(), ORIGIN);
    expect(config.manifest?.metaData.publicPath).toBe(
      `${ORIGIN}/cf/studio-kits/v1/kits/hello-kit/0.1.0/mfe/${'0'.repeat(32)}/hello/`
    );
  });

  it('registers a package once per version, and a new version in its place', async () => {
    await kits.sync([helloKitManifest()], ORIGIN);
    expect(helloTabs()).toHaveLength(1);
    await kits.sync([{ ...helloKitManifest(), version: '0.2.0' }], ORIGIN);
    expect(kits.failures()).toEqual([]);
    expect(helloTabs()).toHaveLength(1);
  });

  it('keeps its own unchanged schemas through concurrent version updates', async () => {
    const item = helloKitManifest();
    const config = { ...(item.config as Record<string, unknown>), schemas: [{
      $id: 'gts://gts.example.hello_kit.domain.note.v1~',
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { title: { type: 'string' } },
    }] };
    await Promise.all([
      kits.sync([{ ...item, version: '0.2.1', config }], ORIGIN),
      kits.sync([{ ...item, version: '0.2.2', config }], ORIGIN),
    ]);
    expect(kits.failures()).toEqual([]);
    expect(helloTabs()).toHaveLength(1);
    kits.mountFailed(helloTabs()[0].id, 'test');
    expect(kits.failures()[0].version).toBe('0.2.2');
    kits.dismiss('hello-kit/hello');
  });

  it('still refuses a kit that redeclares a schema owned by the shell', async () => {
    const item = helloKitManifest();
    await kits.sync([{ ...item, version: '0.2.3', config: {
      ...(item.config as Record<string, unknown>), schemas: [SHELL_SCHEMAS[0]],
    } }], ORIGIN);
    expect(kits.failures()[0].reason).toContain('already registered');
    expect(helloTabs()).toHaveLength(1);
    kits.dismiss('hello-kit/hello');
  });

  // `npx vite build` in examples/kits/hello-kit: the bundle as the backend would serve it.
  it.skipIf(!existsSync(BUILT_HELLO))('registers the demo kit as its build wrote it', async () => {
    const config = JSON.parse(readFileSync(BUILT_HELLO, 'utf8'));
    await kits.sync([{ ...helloKitManifest(), version: '0.3.0', config }], ORIGIN);
    expect(kits.failures()).toEqual([]);
    expect(helloTabs()).toHaveLength(1);
  });

  it('puts a runtime screen that did not mount on its tile, and nothing else', () => {
    const [hello] = helloTabs();
    kits.mountFailed(builtIn[0].id, 'nope');
    expect(kits.failures()).toEqual([]);
    kits.mountFailed(hello.id, 'HTTP 404 fetching chunk source');
    expect(kits.failures()).toEqual([
      expect.objectContaining({ kit: 'hello-kit', label: 'Hello', reason: 'HTTP 404 fetching chunk source' }),
    ]);
    kits.dismiss('hello-kit/hello');
    expect(kits.failures()).toEqual([]);
  });
});
