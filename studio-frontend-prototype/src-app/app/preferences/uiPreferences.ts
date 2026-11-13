/**
 * The person's remembered UI choices (`studio-user` `/me/ui-preferences`):
 * the prototype's `view-mode.tsx` store, without its React context.
 *
 * Three layers, in the order they answer:
 *
 * 1. **memory** — what this tab holds right now;
 * 2. **`localStorage`** — read synchronously on first use, so a reload paints
 *    the chosen order at once instead of flashing the default and snapping. A
 *    cache, never the record: per browser, and it can come back empty;
 * 3. **the gear** — the record. One map per person, read once per session,
 *    written whole.
 *
 * Writes are debounced and last-write-wins, and none is sent before the gear
 * has answered: a save racing the load could store a map built from a stale
 * cache. A choice made during the load is laid over the record once it
 * arrives. An absent key means "the default"; setting `''` forgets it.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { IdentityApiService } from '@/app/api/IdentityApiService';

export type Preferences = Readonly<Record<string, string>>;

export interface PreferencesClient {
  read(): Promise<Record<string, string>>;
  save(preferences: Record<string, string>): Promise<unknown>;
}

/** Where the browser mirror lives — the prototype's key, so a choice made there paints here. */
export const PREFERENCES_CACHE_KEY = 'studio.ui-preferences.v1';

/** Long enough that dragging back and forth is one request, short enough that closing the tab still saves. */
export const SAVE_DEBOUNCE_MS = 500;

export interface PreferenceStore {
  get(): Preferences;
  set(key: string, value: string): void;
  subscribe(listener: () => void): () => void;
  /** Reads the record once; later calls return the same read. */
  load(): Promise<void>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function readCache(storage: StorageLike | null): Record<string, string> {
  try {
    const raw = storage?.getItem(PREFERENCES_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeCache(storage: StorageLike | null, prefs: Preferences): void {
  try {
    storage?.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // Out of quota, or storage denied. The gear still has it.
  }
}

export function createPreferenceStore(
  client: PreferencesClient,
  { storage = safeStorage(), debounceMs = SAVE_DEBOUNCE_MS }: { storage?: StorageLike | null; debounceMs?: number } = {}
): PreferenceStore {
  let prefs: Preferences = readCache(storage);
  let loaded = false;
  let loading: Promise<void> | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const madeWhileLoading = new Map<string, string>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const flush = () => {
    pending = null;
    if (!loaded) return;
    void client.save({ ...prefs }).catch(() => {
      // The choice still holds for this session and this browser. A view
      // preference failing loudly would be worse than quietly.
    });
  };

  return {
    get: () => prefs,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(key, value) {
      if ((prefs[key] ?? '') === value) return;
      const next: Record<string, string> = { ...prefs };
      if (value) next[key] = value;
      else delete next[key];
      prefs = next;
      writeCache(storage, prefs);
      emit();
      if (!loaded) madeWhileLoading.set(key, value);
      if (pending) clearTimeout(pending);
      pending = setTimeout(flush, debounceMs);
    },
    load() {
      loading ??= client.read().then(
        (stored) => {
          loaded = true;
          // The gear is the record, so it replaces the mirror rather than
          // merging into it — otherwise a preference cleared on another
          // machine would keep coming back from this browser's cache.
          // A choice made while the read was in flight is the newest word:
          // it goes on top of the record, and is saved now that there is a
          // record to save over.
          const next: Record<string, string> = { ...stored };
          for (const [key, value] of madeWhileLoading) {
            if (value) next[key] = value;
            else delete next[key];
          }
          prefs = next;
          writeCache(storage, prefs);
          emit();
          if (madeWhileLoading.size > 0) {
            madeWhileLoading.clear();
            if (pending) clearTimeout(pending);
            flush();
          }
        },
        () => {
          // Gear unreachable, or a backend without the route. The cache
          // carries the session; nothing is saved, so a failed read cannot
          // overwrite what is stored.
        }
      );
      return loading;
    },
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let shellStore: PreferenceStore | null = null;

/** The shell's store, over `IdentityApiService` (registered in `main.tsx`). */
export function preferenceStore(): PreferenceStore {
  shellStore ??= createPreferenceStore({
    read: async () => {
      const identity = apiRegistry.getService(IdentityApiService);
      return (await identity.uiPreferences.fetch({ staleTime: 0 }))?.preferences ?? {};
    },
    save: (preferences) => apiRegistry.getService(IdentityApiService).saveUiPreferences.fetch({ preferences }),
  });
  return shellStore;
}

/** Replaces the shell's store. For tests. */
export function setPreferenceStoreForTests(store: PreferenceStore | null): void {
  shellStore = store;
}

/** One remembered choice and how to change it. `''` reads as absent. */
export function usePreference(key: string): [string, (value: string) => void] {
  const store = preferenceStore();
  useEffect(() => {
    void store.load();
  }, [store]);
  const prefs = useSyncExternalStore(store.subscribe, store.get, store.get);
  const set = useCallback((value: string) => store.set(key, value), [store, key]);
  return [prefs[key] ?? '', set];
}
