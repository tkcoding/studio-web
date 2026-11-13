/**
 * The demo kit's package (`examples/kits/hello-kit`) as `studio-kits` lists
 * it at run time, without building the kit: its own `mfe.json`, with what the
 * build adds (`manifest.metaData`, each entry's `exposeAssets`) filled in the
 * shape `frontxMfGts` writes. What the contract tests hold a runtime kit to.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KitMfeManifest } from '@/app/api/InstalledKitsApiService';

const HELLO_KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/kits/hello-kit');

export const HELLO_KIT_SLUG = 'hello-kit';

interface DeclaredMfeJson {
  manifest: { id: string };
  entries: Array<Record<string, unknown>>;
  extensions: Array<Record<string, unknown>>;
}

/** `hello-kit` at 0.1.0, as the backend would list it. */
export function helloKitManifest(): KitMfeManifest {
  const declared = JSON.parse(readFileSync(path.join(HELLO_KIT, 'mfe.json'), 'utf8')) as DeclaredMfeJson;
  const manifestPath = `/cf/studio-kits/v1/kits/${HELLO_KIT_SLUG}/0.1.0/mfe/${'0'.repeat(32)}/hello/mfe-manifest.json`;
  const config = {
    manifest: {
      id: declared.manifest.id,
      name: 'helloKit',
      metaData: {
        name: 'helloKit',
        type: 'app',
        buildInfo: { buildVersion: '0.1.0', buildName: 'helloKit' },
        remoteEntry: { name: 'remoteEntry.js', path: '', type: 'module' },
        globalName: 'helloKit',
        publicPath: 'auto',
      },
      shared: [],
    },
    entries: declared.entries.map((entry) => ({
      ...entry,
      exposeAssets: {
        js: { sync: ['assets/lifecycle-0000.js'], async: [] },
        css: { sync: [], async: [] },
      },
    })),
    extensions: declared.extensions,
  };
  return {
    kit_slug: HELLO_KIT_SLUG,
    version: '0.1.0',
    package: 'hello',
    base_path: manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1),
    config,
    error: null,
  };
}
