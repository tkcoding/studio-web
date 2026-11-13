/**
 * The order a person keeps a level's tabs in, over `tab-order.ts` (the
 * prototype's, unchanged) and the person's `/me/ui-preferences`.
 *
 * One order per level, not per organization or project: it is a choice about
 * the person ("I live in Specs and Team"), so it follows them to every project
 * and every machine. The keys are the prototype's (`project.tabs.order`,
 * `workspace.tabs.order`), extended to every level the shell has.
 *
 * A tab is stored by the last segment of its route — `specs` for
 * `/projects/specs`, `tests` for `/tests` — short, so that a level's order
 * fits the 128 characters a preference may hold, and stable across the
 * manifests' extension ids. The prototype's project tab ids are the same words
 * where the sections are the same, so an order kept there carries over.
 */

import type { ScreenLevel, StudioScreenExtension } from '@/app/mfe/screenLevels';
import { applyOrder, parseOrder } from './tab-order';

export function tabOrderKey(level: ScreenLevel): string {
  return `${level}.tabs.order`;
}

/** The id a tab is stored under: its route's last segment, or its extension id when it has no route. */
export function tabIdOf(extension: StudioScreenExtension): string {
  const segments = (extension.presentation?.route ?? '').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? extension.id;
}

export interface OrderedTab {
  id: string;
  extension: StudioScreenExtension;
}

/** The level's tabs (in their declared order) in the order the person keeps. */
export function orderLevelTabs(items: readonly StudioScreenExtension[], stored: string): OrderedTab[] {
  const seen = new Set<string>();
  const tabs: OrderedTab[] = [];
  for (const extension of items) {
    // Two tabs ending in the same word would share one place in the stored
    // order; the second keeps its full id and its declared place instead.
    let id = tabIdOf(extension);
    if (seen.has(id)) id = extension.id;
    seen.add(id);
    tabs.push({ id, extension });
  }
  return applyOrder(tabs, parseOrder(stored));
}
