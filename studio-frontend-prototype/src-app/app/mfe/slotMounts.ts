/**
 * Mounting a slot's contributions, one by one (`mfe/slots.ts`).
 *
 * `reconcile(wanted)` is called with the contributions that should show now,
 * in order. It mounts each that is not mounted, unmounts each mounted one that
 * is no longer wanted, and leaves the rest alone. Every mount is its own
 * action chain: one that fails is remembered with its reason, put on the
 * runtime kit tile when a kit brought it, and not tried again while its
 * registration is the same — the others are untouched. What is mounted is
 * read from the domain's own reports (`occupancyOf`), so a contribution the
 * runtime released when its kit was unregistered or upgraded is mounted again
 * once it is wanted.
 */

import {
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_ACTION_UNMOUNT_EXT,
  type Extension,
  type MfeRegistry,
} from '@gears-frontx/react';
import { occupancyOf } from '@/app/mfe/domainOccupancy';
import { runtimeKitsOf } from '@/app/mfe/runtimeKits';
import { executeAndSettle } from '@/app/mfe/shellOutcomes';

export interface SlotFailure {
  id: string;
  label: string;
  reason: string;
}

export interface SlotMounts {
  reconcile(wanted: readonly Extension[]): void;
  failures(): readonly SlotFailure[];
  subscribe(listener: () => void): () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const labelOf = (extension: Extension): string =>
  (extension as { presentation?: { label?: string } }).presentation?.label ?? extension.id;

export function createSlotMounts(registry: MfeRegistry, domainId: string): SlotMounts {
  /** Mounts asked for and not finished. */
  const inFlight = new Set<string>();
  /** Failed contributions, with the registration that failed: another one is tried afresh. */
  const failed = new Map<string, { extension: Extension; failure: SlotFailure }>();
  let failureList: readonly SlotFailure[] = [];
  const listeners = new Set<() => void>();
  let wantedIds: ReadonlySet<string> = new Set();

  const publish = (): void => {
    failureList = [...failed.values()].map((f) => f.failure);
    for (const listener of [...listeners]) listener();
  };

  const mounted = (): readonly string[] => occupancyOf(registry).mounted(domainId);

  const mount = (extension: Extension): void => {
    inFlight.add(extension.id);
    void executeAndSettle(registry, {
      type: FRONTX_ACTION_MOUNT_EXT,
      target: domainId,
      payload: { subject: extension.id },
    })
      .then(
        () => {
          if (!mounted().includes(extension.id)) throw new Error('the actions chain did not complete');
        }
      )
      .catch((error: unknown) => {
        const reason = messageOf(error);
        failed.set(extension.id, { extension, failure: { id: extension.id, label: labelOf(extension), reason } });
        runtimeKitsOf(registry).mountFailed(extension.id, reason);
        publish();
      })
      .finally(() => {
        inFlight.delete(extension.id);
        const isMounted = mounted().includes(extension.id);
        // Left while it was mounting: take it out again.
        if (!wantedIds.has(extension.id) && isMounted) unmount(extension.id);
        // Released while it was mounting (its kit was upgraded): mount the registration there is now.
        const current = registry.getExtension(extension.id);
        if (wantedIds.has(extension.id) && !isMounted && !failed.has(extension.id) && current) mount(current);
      });
  };

  const unmount = (id: string): void => {
    // An unregistered contribution was released by the runtime already.
    if (!registry.getExtension(id)) return;
    void executeAndSettle(registry, {
      type: FRONTX_ACTION_UNMOUNT_EXT,
      target: domainId,
      payload: { subject: id },
    }).catch((error: unknown) => console.warn(`[Slots] could not unmount ${id}: ${messageOf(error)}`));
  };

  return {
    reconcile(wanted) {
      wantedIds = new Set(wanted.map((extension) => extension.id));
      let changed = false;
      for (const [id, entry] of [...failed]) {
        // Gone, or registered again (an upgrade): its failure says nothing now.
        if (!wantedIds.has(id) || registry.getExtension(id) !== entry.extension) {
          failed.delete(id);
          changed = true;
        }
      }
      if (changed) publish();
      const now = mounted();
      for (const id of now) if (!wantedIds.has(id) && !inFlight.has(id)) unmount(id);
      for (const extension of wanted) {
        if (now.includes(extension.id) || inFlight.has(extension.id) || failed.has(extension.id)) continue;
        mount(extension);
      }
    },
    failures: () => failureList,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const perRegistry = new WeakMap<MfeRegistry, Map<string, SlotMounts>>();

/** The mounts of one slot domain: one per registry and domain. */
export function slotMountsOf(registry: MfeRegistry, domainId: string): SlotMounts {
  let byDomain = perRegistry.get(registry);
  if (!byDomain) {
    byDomain = new Map();
    perRegistry.set(registry, byDomain);
  }
  let mounts = byDomain.get(domainId);
  if (!mounts) {
    mounts = createSlotMounts(registry, domainId);
    byDomain.set(domainId, mounts);
  }
  return mounts;
}
