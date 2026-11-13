/**
 * Forgetting a remote the page has loaded (issue #1006).
 *
 * `MfeHandlerMF` keeps every load for the life of the page, keyed by the
 * extension id, and a mount of the same id reuses it — the never-revoke
 * invariant of `@gears-frontx/mfes`. A kit upgraded at run time keeps its
 * extension ids, so without this its next mount would run the old version's
 * module until the page is reloaded.
 *
 * The cache is the handler's private static; mfes 0.4 has no public way to
 * evict an entry. This reads it by name and does nothing when it is not
 * there, so a FrontX release that renames it degrades to "the new version
 * shows after a reload", never to an error. The upstream ask: an
 * `MfeHandlerMF.evict(extensionId)` (or eviction on `unregisterExtension`).
 *
 * The old module's blob URLs are not revoked: a mount still running from them
 * may need them, and the runtime never revokes either.
 */

import { MfeHandlerMF } from '@gears-frontx/react';

/** Whether the handler had a load of `extensionId`, which the next mount now makes afresh. */
export function forgetLoadedRemote(extensionId: string): boolean {
  const cache = (MfeHandlerMF as unknown as { loadCache?: unknown }).loadCache;
  if (!(cache instanceof Map)) return false;
  return cache.delete(extensionId);
}
