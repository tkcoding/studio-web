/**
 * The pins as the shell's chrome uses them: one list for the tabs' Pin button
 * and the header's pins menu, kept in this browser (`pins.ts`), and the pin
 * the section on screen would be.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { ContextEntity } from '@/app/slices/appContextSlice';
import { sectionOf, type ScreenLevel, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { tokenOf } from '@/app/routing/screenTokens';
import { loadPins, savePins, togglePin, type Pin, type PinRoute } from './pins';

let current: Pin[] | null = null;
const listeners = new Set<() => void>();

function snapshot(): Pin[] {
  current ??= loadPins();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPins(next: Pin[]): void {
  current = next;
  savePins(next);
  for (const listener of [...listeners]) listener();
}

/** Forgets the in-memory list, so the next read is the browser's. For tests. */
export function resetPinsForTests(): void {
  current = null;
}

export function usePins(): { pins: Pin[]; toggle: (pin: Pin) => void } {
  const pins = useSyncExternalStore(subscribe, snapshot, snapshot);
  const toggle = useCallback((pin: Pin) => setPins(togglePin(snapshot(), pin)), []);
  return { pins, toggle };
}

export interface PinContext {
  org: ContextEntity | null;
  workspace: ContextEntity | null;
  project: ContextEntity | null;
}

/**
 * The pin for one tab of the level in scope, or `null` when it has no address
 * of its own. The route is the one a click on that tab writes
 * (`appContextEffects`, `routeFor`): the organization always, the workspace
 * below the organization, the project at the project level.
 */
export function pinFor(item: StudioScreenExtension, level: ScreenLevel, context: PinContext): Pin | null {
  const token = tokenOf(item);
  if (!token) return null;
  const route: PinRoute = { token };
  const where: string[] = [];
  if (context.org) {
    route.org = context.org.id;
    if (level !== 'platform') where.push(context.org.name);
  }
  if (level === 'workspace' || level === 'project') {
    if (!context.workspace) return null;
    route.workspace = context.workspace.id;
    where.push(context.workspace.name);
  }
  if (level === 'project') {
    if (!context.project) return null;
    route.project = context.project.id;
    where.push(context.project.name);
  }
  const section = sectionOf(item);
  if (section) route.section = section;
  return { route, label: item.presentation.label ?? token, where };
}
