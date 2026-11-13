/// <reference types="node" />
/**
 * "Connect a cluster" shows the manifest a cluster's administrator applies
 * once. The prototype imported the repository's file at build time; this
 * package keeps a copy, because the portal's image builds from
 * studio-frontend-prototype/ alone (Dockerfile.src copies only that). The copy
 * must be the repository's file, byte for byte: a changed bootstrap is copied
 * here in the same change.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const COPY = path.join(here, 'bootstrap.yaml');
const SOURCE = path.resolve(here, '../../../../../../deploy/k8s/studio-environments/bootstrap.yaml');

describe('the bootstrap manifest', () => {
  it.skipIf(!existsSync(SOURCE))('is the repository’s deploy/k8s/studio-environments/bootstrap.yaml', () => {
    expect(readFileSync(COPY, 'utf8').replace(/\r\n/g, '\n')).toBe(readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n'));
  });

  it('gives the deployer account its rights and says how to read its token', () => {
    const text = readFileSync(COPY, 'utf8');
    expect(text).toMatch(/kind:\s*ServiceAccount/);
    expect(text).toContain('deployer');
  });
});
