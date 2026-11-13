// The demo kit's bundle: the same Module Federation build every portal MFE
// uses (src-app/mfe_packages/tests-mfe/vite.config.ts), written into
// `mfe/hello/` beside kit.gdl instead of `dist/`, where the kit's manifest
// says its bundle is. The shell provides the shared dependencies at run time;
// everything else, @constructor-studio/mfe-shared and the ui-kit included,
// travels inside the bundle.
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
      name: 'helloKit',
      filename: 'remoteEntry.js',
      // No type archive (@mf-types.zip): nothing consumes it, and generating it
      // ran tsc over the whole MFE on every build.
      dts: false,
      exposes: {
        './lifecycle': './src/lifecycle.tsx',
        // Contributions into the shell's named slots (mfe/slots.ts in the shell).
        './panel': './src/panel.tsx',
        './status': './src/status.tsx',
      },
      // Shared deps are externalized below and provided by the shell's
      // handler at run time, exactly as for a built-in MFE.
      shared: {},
      manifest: true,
    }),
    frontxMfGts(),
  ],
  build: {
    outDir: 'mfe/hello',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    minify: true,
    cssCodeSplit: true,
    rollupOptions: {
      external: sharedDeps,
    },
  },
});
