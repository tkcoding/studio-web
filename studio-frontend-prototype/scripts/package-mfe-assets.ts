#!/usr/bin/env node

/** Copy built MFE remotes into the host Vite output for a single deployable image. */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.cwd();
const packagesRoot = join(projectRoot, 'src-app', 'mfe_packages');
const outputRoot = join(projectRoot, 'dist', 'mfes');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const packages = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(packagesRoot, name, 'mfe.json')));

for (const packageName of packages) {
  const source = join(packagesRoot, packageName, 'dist');
  if (!existsSync(source)) {
    throw new Error(`[${packageName}] dist directory not found; build the MFE first`);
  }
  cpSync(source, join(outputRoot, packageName), { recursive: true });
  console.log(`Packaged /mfes/${packageName}/`);
}

console.log(`Packaged ${packages.length} MFE remote(s) into ${outputRoot}`);
