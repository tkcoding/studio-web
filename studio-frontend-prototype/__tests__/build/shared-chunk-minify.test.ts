// @vitest-environment node

/**
 * The standalone shared chunks (`dist/shared/*.js`) are minified after the
 * CJS patches. What the runtime reads off their text has to survive: the
 * handler rewrites `from "<shared dep>"` to a blob URL with a regex, and an
 * MFE imports named bindings the patch added.
 */

import { describe, expect, it } from 'vitest';
import { minifySharedChunkSource } from '../../src/build/mf-gts';

/** The pattern `@gears-frontx/mfes` 0.4 rewrites a bare specifier with (`bareSpecifierPattern`). */
const handlerPattern = (name: string) =>
  new RegExp(String.raw`(from|import)(\s*["'])(${name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)})(["'])`, 'g');

// What `patchCjsExternals` + `patchCjsNamedExports` leave in a CJS dependency's chunk.
const patched = [
  'import __ext_react from "react";',
  'var require_lib = (exports) => {',
  '  // node_modules/some-lib/index.js',
  '  exports.useThing = function useThing() { return __ext_react.useState(0); };',
  '  exports.VERSION = "1.0.0";',
  '  if (process.env.NODE_ENV !== "production") { console.log("development build"); }',
  '};',
  'var __mod_default = (() => { const e = {}; require_lib(e); return e; })();',
  'export default __mod_default;',
  'export var { useThing, VERSION } = __mod_default;',
].join('\n');

describe('minifySharedChunkSource', () => {
  it('is smaller and keeps the bare import the handler rewrites', async () => {
    const out = await minifySharedChunkSource(patched);

    expect(out.length).toBeLessThan(patched.length);
    expect(out.match(handlerPattern('react'))).toHaveLength(1);
  });

  it('keeps every export name an MFE imports', async () => {
    const out = await minifySharedChunkSource(patched);
    const exported = [...out.matchAll(/export\s*\{([^}]*)\}/g)]
      .flatMap((m) => m[1].split(','))
      .map((part) => part.trim().split(/\s+as\s+/).pop());

    expect(exported).toEqual(expect.arrayContaining(['default', 'useThing', 'VERSION']));
  });

  it('drops the development-only branch', async () => {
    expect(await minifySharedChunkSource(patched)).not.toContain('development build');
  });

  it('gives the same bytes for the same input, so contentHash stays shared across MFEs', async () => {
    expect(await minifySharedChunkSource(patched)).toBe(await minifySharedChunkSource(patched));
  });
});
