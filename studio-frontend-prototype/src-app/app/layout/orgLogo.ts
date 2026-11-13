/**
 * An organization's logo in the path bar and its switcher, as the prototype's
 * `OrgMark` showed it (`org-logo.ts`, `level-marks.tsx`): read once per
 * organization and shared, the initial-less glyph kept when there is none.
 * Admin › Organizations sets it; this only reads `GET /studio-organizations/v1/logo`.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { OrganizationsApiService } from '@/app/api/OrganizationsApiService';

export interface LogoReader {
  (orgId: string): Promise<{ content_type: string; data: string }>;
}

/** The image as an `<img>` source. */
export function logoSrc(logo: { content_type: string; data: string }): string {
  return `data:${logo.content_type};base64,${logo.data}`;
}

export interface LogoStore {
  get(orgId: string): string | null | undefined;
  /** Reads once; a failure or a 404 is remembered as no logo, not asked again. */
  read(orgId: string): void;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createLogoStore(reader: LogoReader | null): LogoStore {
  const logos = new Map<string, string | null>();
  const reading = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  return {
    get: (orgId) => logos.get(orgId),
    read(orgId) {
      if (!reader || logos.has(orgId) || reading.has(orgId)) return;
      reading.add(orgId);
      reader(orgId)
        .then(
          (logo) => logos.set(orgId, logo?.data ? logoSrc(logo) : null),
          () => logos.set(orgId, null)
        )
        .finally(() => {
          reading.delete(orgId);
          changed();
        });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}

let shared: LogoStore | null = null;

function sharedStore(): LogoStore {
  shared ??= createLogoStore(
    apiRegistry.has(OrganizationsApiService)
      ? (orgId) => apiRegistry.getService(OrganizationsApiService).logo({ orgId }).fetch()
      : null
  );
  return shared;
}

/** Replaces the shared store. For tests. */
export function setLogoStoreForTests(store: LogoStore | null): void {
  shared = store;
}

/** The organization's logo as an `<img>` source; null when it has none or is not read yet. */
export function useOrgLogo(orgId: string | null | undefined): string | null {
  const store = sharedStore();
  useSyncExternalStore(store.subscribe, store.version, store.version);
  useEffect(() => {
    if (orgId) store.read(orgId);
  }, [store, orgId]);
  return orgId ? (store.get(orgId) ?? null) : null;
}
