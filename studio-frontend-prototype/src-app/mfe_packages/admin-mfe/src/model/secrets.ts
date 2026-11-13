/**
 * Which secret references the portal knows about — the prototype's
 * `useKnownSecretRefs` (`App.tsx`) and `asRows`/`named`
 * (`project-sources.ts`) at 00828880, as pure functions. credstore has no list
 * endpoint, so the list is built from the references workspace settings and
 * the connections behind a workspace's sources name.
 */

import type { ProjectSource } from '@constructor-studio/mfe-shared';
import type { Connection } from '../api/types';

export interface SecretRow {
  ref: string;
  usedBy: string[];
}

/** What one workspace says about secrets. */
export interface WorkspaceSecrets {
  name: string;
  /** The project root's credstore reference, from the workspace settings. */
  rootTokenRef?: string | null;
  sources?: readonly ProjectSource[];
  connections: readonly Connection[];
}

function checkoutDir(fullPath: string): string {
  const last = fullPath.split('/').filter(Boolean).pop() ?? '';
  return last.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'source';
}

/** Each source that is cloned, with the directory it is cloned into, suffixed when taken. */
export function named(sources: readonly ProjectSource[] | undefined): { source: ProjectSource; dir: string }[] {
  const taken = new Set<string>();
  return (sources ?? [])
    .filter((s) => s?.clone_url?.trim())
    .map((source) => {
      const base = checkoutDir(source.full_path ?? '');
      let dir = base;
      for (let n = 2; taken.has(dir); n += 1) dir = `${base}-${n}`;
      taken.add(dir);
      return { source, dir };
    });
}

/** Every reference, with who uses it ("Workspace (project root)", "Workspace / repo"), by reference. */
export function knownSecretRefs(workspaces: readonly WorkspaceSecrets[]): SecretRow[] {
  const map = new Map<string, Set<string>>();
  const add = (ref: string | null | undefined, who: string) => {
    const r = ref?.trim();
    if (!r) return;
    if (!map.has(r)) map.set(r, new Set());
    map.get(r)?.add(who);
  };
  for (const ws of workspaces) {
    add(ws.rootTokenRef, `${ws.name} (project root)`);
    const byId = new Map(ws.connections.map((c) => [c.id, c]));
    // A repository's token is its connection's.
    for (const { source, dir } of named(ws.sources)) add(byId.get(source.connection_id)?.secret_ref, `${ws.name} / ${dir}`);
  }
  return [...map.entries()]
    .map(([ref, used]) => ({ ref, usedBy: [...used].sort() }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
}
