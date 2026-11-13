/**
 * The MFE -> shell channel for opening another screen (ADR-0069): a kit's
 * screen leads to a screen it does not own — an Overview row to Connections,
 * the Tests kit's spec card to Specs. The MFE names the screen by its manifest
 * route; the shell finds the registered extension and asks for it the way a
 * tab click does, so the address, the level and the section all follow.
 */

import { ActionHandler, eventBus } from '@gears-frontx/react';
import type { StudioScreenExtension } from './screenLevels';

/** The route the payload names, or `null` when it is not one. */
export function routeOf(payload: Record<string, unknown> | undefined): string | null {
  const route = payload?.route;
  return typeof route === 'string' && route.startsWith('/') ? route : null;
}

/** The screen a route names among the registered ones. */
export function screenForRoute(
  screens: readonly StudioScreenExtension[],
  route: string
): StudioScreenExtension | undefined {
  return screens.find((screen) => screen.presentation?.route === route);
}

export function createScreenOpenHandler(screens: () => readonly StudioScreenExtension[]): ActionHandler {
  return ActionHandler.fromFunction(async (_actionTypeId, payload) => {
    const route = routeOf(payload);
    const target = route ? screenForRoute(screens(), route) : undefined;
    if (!target) {
      console.warn('[shell] screen.open: no screen answers to', payload);
      return;
    }
    eventBus.emit('app/context/screen/requested', { extensionId: target.id });
  });
}
