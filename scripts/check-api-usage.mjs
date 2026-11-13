#!/usr/bin/env node
/**
 * Do both portals still call endpoints that exist?
 *
 * The backend's API surface is committed at
 * `studio-backend/docs/api-contract.json`, generated from the source by
 * `studio-backend api-contract` and drift-checked by `cargo test`. This script
 * reads it and every URL literal in `studio-frontend` and
 * `studio-frontend-prototype`, and fails when a portal calls a path the
 * backend does not register.
 *
 * That is rule G3 of `docs/api-conventions.md` made mechanical: a path that
 * moves has to move in all three trees in the same PR, and until now nothing
 * said otherwise until someone opened the screen.
 *
 * It is deliberately a Node script rather than another Rust test: it has to run
 * on a frontend-only change too, and the backend's CI job does not.
 *
 * A path written inside a comment is checked like any other — a doc comment
 * pointing at an endpoint that moved misleads as effectively as a call does.
 *
 *   node scripts/check-api-usage.mjs           # check (exit 1 on a break)
 *   node scripts/check-api-usage.mjs --list    # also list what nobody calls
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WILDCARD,
  baseUrl,
  literals,
  normalise as normaliseCall,
  relativeEndpoints,
  sources,
} from './api-usage-lib.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONTRACT = join(ROOT, 'studio-backend/docs/api-contract.json');
const BASELINE = join(ROOT, 'scripts/api-usage-baseline.txt');

/** Where a portal's sources live. */
const PORTALS = [
  { name: 'studio-frontend', dirs: ['studio-frontend/src', 'studio-frontend/src-app'] },
  { name: 'studio-frontend-prototype', dirs: ['studio-frontend-prototype/src', 'studio-frontend-prototype/src-app'] },
];

// ---------------------------------------------------------------------------
// The backend surface
// ---------------------------------------------------------------------------

if (!existsSync(CONTRACT)) {
  console.error(
    `No API contract at ${relative(ROOT, CONTRACT)}.\n` +
      'Generate it with: cd studio-backend && cargo run --quiet -- api-contract > docs/api-contract.json'
  );
  process.exit(2);
}

const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));

/** Every registered path, as segment arrays, with the methods it answers. */
const registered = [];
/** The domains this assembly owns. A path outside them is somebody else's. */
const ownDomains = new Set();

for (const operation of contract.operations) {
  if (operation.path.startsWith('<dynamic')) continue; // no path to match
  const segments = operation.path.split('/').filter(Boolean);
  ownDomains.add(segments[0]);
  const existing = registered.find((entry) => entry.path === operation.path);
  if (existing) existing.methods.add(operation.method);
  else
    registered.push({
      path: operation.path,
      segments: segments.map((segment) => (segment.startsWith('{') ? WILDCARD : segment)),
      // `{*file}` takes the rest of the path, so a base path under it (a kit's
      // bundle root, say) is that route too.
      catchAll: segments.at(-1)?.startsWith('{*') ?? false,
      methods: new Set([operation.method]),
      calledBy: new Set(),
    });
}

// ---------------------------------------------------------------------------
// What the portals ask for
// ---------------------------------------------------------------------------

/** Literals we could not read, so the summary can be honest about them. */
const stats = { unparsed: 0 };
const normalise = (raw) => normaliseCall(raw, stats);

const asked = new Map(); // normalised path string -> Set of "portal:file"

function record(segments, where) {
  const key = segments.join('/');
  if (!asked.has(key)) asked.set(key, { segments, sites: new Set() });
  asked.get(key).sites.add(where);
}

for (const portal of PORTALS) {
  for (const dir of portal.dirs) {
    for (const file of sources(join(ROOT, dir))) {
      const text = readFileSync(file, 'utf8');
      const where = `${portal.name}:${relative(join(ROOT, portal.name), file).split(sep).join('/')}`;
      const base = baseUrl(text);

      for (const literal of literals(text)) {
        const segments = normalise(literal);
        if (segments) record(segments, where);
      }
      if (base) {
        for (const suffix of relativeEndpoints(text)) {
          const segments = normalise(base + suffix);
          if (segments) record(segments, where);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

function matches(asked, backend, catchAll) {
  const fixed = catchAll ? backend.length - 1 : backend.length;
  if (catchAll ? asked.length < fixed : asked.length !== fixed) return false;
  return asked
    .slice(0, fixed)
    .every(
      (segment, index) =>
        segment === WILDCARD || backend[index] === WILDCARD || segment === backend[index]
    );
}

const missing = [];
let external = 0;

for (const [key, entry] of asked) {
  const domain = entry.segments[0];
  if (!ownDomains.has(domain)) {
    external += 1; // account-management and the other platform gears
    continue;
  }
  const hit = registered.find((candidate) =>
    matches(entry.segments, candidate.segments, candidate.catchAll)
  );
  if (hit) {
    for (const site of entry.sites) hit.calledBy.add(site);
  } else {
    missing.push({ key, entry });
  }
}

const baseline = existsSync(BASELINE)
  ? new Set(
      readFileSync(BASELINE, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    )
  : new Set();

const readable = (key) => key.split(WILDCARD).join('{}');
// Sorted so a failing run reads the same twice: the scan order follows the
// filesystem, which is not the same on two machines.
const fresh = missing
  .filter(({ key }) => !baseline.has(readable(key)))
  .sort((a, b) => a.key.localeCompare(b.key));
const stale = [...baseline].filter(
  (line) => !missing.some(({ key }) => readable(key) === line)
);

if (process.argv.includes('--list')) {
  const uncalled = registered.filter((entry) => entry.calledBy.size === 0);
  console.log(`\nRegistered and called by neither portal (${uncalled.length}):\n`);
  for (const entry of uncalled) console.log(`  ${[...entry.methods].sort().join('/')} ${entry.path}`);
}

let failed = false;

if (fresh.length > 0) {
  failed = true;
  console.error(`\nThese calls have no endpoint behind them (${fresh.length}):\n`);
  for (const { key, entry } of fresh) {
    console.error(`  ${readable(key)}`);
    for (const site of [...entry.sites].sort()) console.error(`      ${site}`);
  }
  console.error(
    '\nEither the path moved on the backend and the portal did not follow (rule G3),\n' +
      'or the call is a typo. If the call is deliberately ahead of the backend, add\n' +
      'its line to scripts/api-usage-baseline.txt.'
  );
}

if (stale.length > 0) {
  failed = true;
  console.error(
    `\nThese baseline entries no longer happen — delete them from ` +
      `scripts/api-usage-baseline.txt (${stale.length}):\n`
  );
  for (const line of stale) console.error(`  ${line}`);
}

if (!failed) {
  const called = registered.filter((entry) => entry.calledBy.size > 0).length;
  console.log(
    `API usage OK: ${asked.size} distinct calls across both portals, ` +
      `${called}/${registered.length} registered paths in use, ` +
      `${external} to platform gears, ${stats.unparsed} literals unreadable, ` +
      `${baseline.size} known breaks.`
  );
}

process.exit(failed ? 1 : 0);
