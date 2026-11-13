// @cpt-dod:cpt-frontx-dod-mfe-isolation-mf-vite-plugin:p1
// @cpt-flow:cpt-frontx-flow-mfe-isolation-build-v2:p2
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { frontxMfGts } from '@gears-frontx/frontx-template-shell/build/mf-gts';

const sharedDeps = [
  'react',
  'react-dom',
  '@gears-frontx/react',
  '@gears-frontx/framework',
  '@gears-frontx/state',
  '@gears-frontx/mfes',
  '@gears-frontx/routing',
  '@gears-frontx/gts-plugin',
  '@gears-frontx/api',
  '@gears-frontx/i18n',
  '@tanstack/react-query',
  '@reduxjs/toolkit',
  'react-redux',
];

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'infrastructureMfe',
      filename: 'remoteEntry.js',
      // No type archive (@mf-types.zip): nothing consumes it, and generating it
      // ran tsc over the whole MFE on every build.
      dts: false,
      exposes: {
        './lifecycle': './src/lifecycle.tsx',
        // Second entry: Organization › Constructor Research, the constructor-research
        // kit's screen (its own lifecycle: one singleton holds one root).
        './researchLifecycle': './src/researchLifecycle.tsx',
      },
      // Empty shared config — MF 2.0's shared dep mechanism is bypassed.
      // Shared deps are externalized via rollupOptions.external and provided
      // at runtime by the handler's bare-specifier rewriting.
      shared: {},
      // mf-manifest.json must be generated alongside remoteEntry.js so that
      // MfeHandlerMF can discover expose chunk paths without regex-parsing the bundle.
      manifest: true,
      // The one stylesheet goes to every entry, as in projects-mfe: the
      // Research screen is built mostly from Infrastructure's parts.
      bundleAllCSS: true,
    }),
    frontxMfGts(),
  ],
  build: {
    target: 'esnext',
    modulePreload: false,
    /** Default Vite prod behavior; MfeHandlerMF integration test asserts compatibility. */
    minify: true,
    /*
     * OFF with two exposes, as in projects-mfe: Rollup would lift the parts
     * both screens share into a common chunk whose CSS `mf-manifest.json`
     * credits to neither expose, and the handler would never inject it.
     */
    cssCodeSplit: false,
    rollupOptions: {
      // Preserve bare specifiers for shared deps in the output chunks.
      // The handler rewrites these to blob URLs at runtime.
      external: sharedDeps,
    },
  },
});
