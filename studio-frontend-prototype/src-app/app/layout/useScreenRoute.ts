/**
 * The route of the item on screen: the mounted screen's, or — when the
 * mounted screen shows one of its sections — that section's own item
 * (`/projects/overview` while the projects screen shows its overview). What a
 * slot contribution's `presentation.screen` is matched against (`mfe/slots.ts`).
 */

import { useAppSelector, useDomainExtensions, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import { useMountedExtensions } from '@/app/mfe/domainOccupancy';
import { sectionOf, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';

/** The pure part, for the tests. */
export function screenRouteOf(
  registered: readonly StudioScreenExtension[],
  mounted: StudioScreenExtension | undefined,
  section: string | null
): string | null {
  if (!mounted) return null;
  const item = section
    ? registered.find((ext) => ext.entry === mounted.entry && sectionOf(ext) === section)
    : undefined;
  return (item ?? mounted).presentation.route ?? null;
}

export function useScreenRoute(): string | null {
  const registered = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const mounted = useMountedExtensions(FRONTX_SCREEN_DOMAIN)[0] as StudioScreenExtension | undefined;
  const section = useAppSelector(
    (state) => (state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined)?.section ?? null
  );
  return screenRouteOf(registered, mounted, section);
}
