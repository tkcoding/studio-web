/**
 * What the screen area says for a kit's screen opened where the kit is not
 * installed: a built-in kit's screen is registered everywhere (it arrives
 * with the portal's build) and only the tabs leave it out (`screenShows`), so
 * an old link, a pin or a bookmark to it still mounted it — the screen of a
 * kit the place does not have, reading what it may not. Drawn over the screen
 * slot like `UnresolvedScreen`, with the same words and the level's home; a
 * section that needs another kit's domain type (`presentation.needs`) is
 * judged by the same rule as its tab.
 *
 * Unknown hides nothing: while the installed kits (or types) are not known,
 * nothing is drawn.
 */

import {
  eventBus,
  useAppSelector,
  useDomainExtensions,
  FRONTX_SCREEN_DOMAIN,
} from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit/button';
import { useMountedExtensions } from '@/app/mfe/domainOccupancy';
import { levelOf, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import { useShellText } from '@/app/i18n/shellTranslations';
import { screenShows, typesNeeded, useInstalledKits, useInstalledTypes } from './useInstalledKits';
import { screenRouteOf } from './useScreenRoute';

/** The item on screen: the mounted screen, or the section of it on display. */
export function itemOnScreen(
  registered: readonly StudioScreenExtension[],
  mounted: StudioScreenExtension | undefined,
  section: string | null
): StudioScreenExtension | undefined {
  if (!mounted) return undefined;
  const route = screenRouteOf(registered, mounted, section);
  return registered.find((ext) => ext.entry === mounted.entry && ext.presentation.route === route) ?? mounted;
}

export function KitAbsentScreen() {
  const t = useShellText();
  const registered = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const mounted = useMountedExtensions(FRONTX_SCREEN_DOMAIN)[0] as StudioScreenExtension | undefined;
  const section = useAppSelector(
    (state) => (state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined)?.section ?? null
  );
  const item = itemOnScreen(registered, mounted, section);
  const installed = useInstalledKits();
  const types = useInstalledTypes(item !== undefined && typesNeeded(item).length > 0);
  if (!item || screenShows(item, installed, types)) return null;

  const kit = item.presentation.kit;
  const kitMissing = kit !== undefined && installed !== null && !installed.has(kit);
  const label = item.presentation.label ?? item.presentation.route;
  return (
    <div
      className="absolute inset-0 flex flex-col gap-2 bg-card p-6"
      role="alert"
      data-kit-absent-screen={kitMissing ? kit : typesNeeded(item).join(',')}
    >
      <div className="text-body font-medium text-foreground">{t('screen_unknown_title')}</div>
      <div className="text-label text-muted-foreground">
        {kitMissing
          ? t('screen_unknown_kit', { screen: label, kit: kit ?? '' })
          : t('screen_needs_types', { screen: label, types: typesNeeded(item).join(', ') })}
      </div>
      <div>
        <Button onClick={() => eventBus.emit('app/context/level/requested', { level: levelOf(item) })}>
          {t('screen_unknown_home')}
        </Button>
      </div>
    </div>
  );
}
