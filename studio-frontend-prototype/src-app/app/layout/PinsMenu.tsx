/**
 * The pins, in the top bar. The prototype kept them at the top of its rail
 * (`PinnedSection`); this shell has no rail, so they sit beside Search: a
 * star that opens the list. A row opens its section wherever it is — another
 * organization, workspace or project included — and its × unpins it. Pinning
 * happens on the section itself, at the end of its tabs (`LevelTabs`).
 */

import React from 'react';
import { eventBus } from '@gears-frontx/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { Star, X } from 'lucide-react';
import { useShellText } from '@/app/i18n/shellTranslations';
import { usePins } from '@/app/pins/usePins';
import { pinKey } from '@/app/pins/pins';

export const PinsMenu: React.FC = () => {
  const t = useShellText();
  const { pins, toggle } = usePins();
  const label = t('pins');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Star aria-hidden="true" className="size-[1.125rem]" fill={pins.length > 0 ? 'currentColor' : 'none'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-72 rounded-lg">
        <div className="px-2 py-1.5 text-body font-medium text-foreground">{label}</div>
        <DropdownMenuSeparator />
        {pins.length === 0 ? (
          <div className="px-2 py-3" data-pins-empty>
            <div className="text-body text-foreground">{t('pins_empty')}</div>
            <div className="text-label text-muted-foreground">{t('pins_empty_hint')}</div>
          </div>
        ) : (
          pins.map((pin) => (
            <DropdownMenuItem
              key={pinKey(pin)}
              data-pin={pinKey(pin)}
              onClick={() => eventBus.emit('app/pins/open', { route: pin.route })}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body text-foreground">{pin.label}</span>
                {pin.where.length > 0 && (
                  <span className="truncate text-label text-muted-foreground">{pin.where.join(' / ')}</span>
                )}
              </span>
              <button
                type="button"
                className="ml-2 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('pin_unpin', { label: pin.label })}
                title={t('pin_unpin', { label: pin.label })}
                onClick={(e) => {
                  // Unpinning is not opening: the row's own click must not run.
                  e.stopPropagation();
                  e.preventDefault();
                  toggle(pin);
                }}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

PinsMenu.displayName = 'PinsMenu';
