/**
 * The product family hangs off the wordmark, as in the prototype: "Constructor
 * Studio ▾" opens Studio itself, then whatever kits put in this menu
 * (`presentation.placement: "product"` — Docs & API, Architecture, ADR-0069),
 * then Admin once some screen lives on that level. A kit's entry shows only
 * where its kit is installed, like its tabs.
 */

import React from 'react';
import { eventBus, useDomainExtensions, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { Check, ChevronDown, LayoutGrid, Shield } from 'lucide-react';
import { useShellText } from '@/app/i18n/shellTranslations';
import { useMountedExtensions } from '@/app/mfe/domainOccupancy';
import { placementOf, resolveLevelMenu, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { ManifestIcon } from './ManifestIcon';
import { screenShows, useInstalledKits } from './useInstalledKits';

/** The screens kits put in the product menu, in their order. */
export function productScreens(
  screens: readonly StudioScreenExtension[],
  installed: ReadonlySet<string> | null
): StudioScreenExtension[] {
  return screens
    .filter((s) => placementOf(s) === 'product' && screenShows(s, installed))
    .sort((a, b) => (a.presentation.order ?? 999) - (b.presentation.order ?? 999));
}

export const ProductMenu: React.FC = () => {
  const t = useShellText();
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const installed = useInstalledKits();
  const mounted = useMountedExtensions(FRONTX_SCREEN_DOMAIN)[0] as StudioScreenExtension | undefined;
  const products = productScreens(screens, installed);
  const hasAdmin = resolveLevelMenu(screens, 'admin').length > 0;
  const inStudio = !mounted || placementOf(mounted) !== 'product';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 text-heading-2 font-semibold text-foreground hover:bg-muted"
            aria-label={t('product_menu')}
            title={t('product_menu')}
          />
        }
      >
        Constructor Studio
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuItem
          onClick={() => eventBus.emit('app/context/level/requested', { level: 'organization' })}
        >
          <LayoutGrid aria-hidden="true" />
          {t('product_studio')}
          {inStudio && <Check className="ml-auto" aria-hidden="true" />}
        </DropdownMenuItem>
        {products.map((screen) => {
          return (
            <DropdownMenuItem
              key={screen.id}
              onClick={() => eventBus.emit('app/context/screen/requested', { extensionId: screen.id })}
            >
              <ManifestIcon declared={screen.presentation.icon} />
              {screen.presentation.label}
              {mounted?.id === screen.id && <Check className="ml-auto" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
        {hasAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => eventBus.emit('app/context/level/requested', { level: 'admin' })}>
              <Shield aria-hidden="true" />
              {t('user_menu_admin')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

ProductMenu.displayName = 'ProductMenu';
