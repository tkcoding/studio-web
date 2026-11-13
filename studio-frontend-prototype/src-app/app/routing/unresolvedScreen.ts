/**
 * An address no registered screen answers to yet (issue #1006).
 *
 * A kit's screens are registered at run time, after routing has started
 * (`mfe/runtimeKits.ts`). So on a cold load, a link to a kit's screen names a
 * token the registry does not have yet. `materialize` keeps the address and
 * says it is **waiting** until the kits of that scope are registered; if the
 * token is still nobody's then, it is **unknown** — the kit is not installed
 * here, was removed, or the link is wrong — and the screen area says so
 * (`layout/UnresolvedScreen.tsx`) instead of jumping somewhere else.
 *
 * One per registry, as `occupancyOf` is: routing writes it, the screen
 * container reads it.
 */

import type { MfeRegistry } from '@gears-frontx/react';
import type { ScreenLevel } from '@/app/mfe/screenLevels';

export interface UnresolvedScreen {
  /** The address's token. */
  token: string;
  status: 'waiting' | 'unknown';
  /** The level the address implies: what "open the level's home" goes to. */
  level: ScreenLevel;
}

export interface UnresolvedScreenStore {
  get(): UnresolvedScreen | null;
  set(next: UnresolvedScreen | null): void;
  subscribe(listener: () => void): () => void;
}

function sameUnresolved(a: UnresolvedScreen | null, b: UnresolvedScreen | null): boolean {
  if (!a || !b) return a === b;
  return a.token === b.token && a.status === b.status && a.level === b.level;
}

export function createUnresolvedScreenStore(): UnresolvedScreenStore {
  let current: UnresolvedScreen | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      if (sameUnresolved(current, next)) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const stores = new WeakMap<MfeRegistry, UnresolvedScreenStore>();

export function unresolvedScreenOf(registry: MfeRegistry): UnresolvedScreenStore {
  let store = stores.get(registry);
  if (!store) {
    store = createUnresolvedScreenStore();
    stores.set(registry, store);
  }
  return store;
}
