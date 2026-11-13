/**
 * Tells the micro-frontends which screens they may send the person to
 * (`…context.screens.available.v1~`): the registered screens that show where
 * the person is — the shell's own, and a kit's only where its kit is installed
 * (`screenShows`, the tabs' own rule) — and the installed kits. A row on an
 * Overview or in the Inbox reads it (mfe-shared `useScreenAvailability`) and
 * offers no button to a tab that is not there.
 *
 * Renders nothing; mounted once by the Layout.
 */

import { useEffect } from 'react';
import { useDomainExtensions, useFrontX, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import type { AvailableScreens as Available } from '@constructor-studio/mfe-shared';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { publishAvailableScreens } from '@/app/mfe/sharedContext';
import { screenShows, useInstalledKits } from './useInstalledKits';

/** What the shell publishes for these screens and installed kits (`null`: unknown). */
export function availableScreens(
  screens: readonly StudioScreenExtension[],
  installed: ReadonlySet<string> | null
): Available {
  const routes = new Set<string>();
  for (const screen of screens) {
    const route = screen.presentation?.route;
    if (route && screenShows(screen, installed)) routes.add(route);
  }
  return { routes: [...routes].sort(), kits: installed ? [...installed].sort() : null };
}

export const AvailableScreens: React.FC = () => {
  const app = useFrontX();
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const installed = useInstalledKits();
  const value = availableScreens(screens, installed);
  // Published by content: a new array of the same screens is not news.
  const key = `${value.routes.join('\n')}|${value.kits?.join('\n') ?? '?'}`;
  useEffect(() => {
    publishAvailableScreens(app, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` is read through its key
  }, [app, key]);
  return null;
};

AvailableScreens.displayName = 'AvailableScreens';
