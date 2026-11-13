/**
 * What the screen area says for an address no registered screen answers to
 * (issue #1006, `routing/unresolvedScreen.ts`): drawn by the shell over the
 * screen slot, which stays mounted underneath.
 *
 * - waiting: the kits of the scope are still being registered — a cold deep
 *   link to a kit's screen shows this, then the screen;
 * - unknown: no installed kit brings that screen here. When a kit brought it
 *   earlier in this page (it was uninstalled, or the person moved to where it
 *   is not installed) it says which kit. The address stays; the button opens
 *   the level's home.
 */

import { useSyncExternalStore } from 'react';
import { eventBus, type MfeRegistry } from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit/button';
import { runtimeKitsOf } from '@/app/mfe/runtimeKits';
import { unresolvedScreenOf } from '@/app/routing/unresolvedScreen';
import { useShellText } from '@/app/i18n/shellTranslations';

export function UnresolvedScreen({ registry }: { registry: MfeRegistry }) {
  const t = useShellText();
  const store = unresolvedScreenOf(registry);
  const unresolved = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (!unresolved) return null;

  if (unresolved.status === 'waiting') {
    return (
      <div
        className="absolute inset-0 bg-card p-6 text-label text-muted-foreground"
        role="status"
        data-unresolved-screen="waiting"
      >
        {t('screen_waiting_for_kits', { screen: unresolved.token })}
      </div>
    );
  }

  const known = runtimeKitsOf(registry).knownScreen(unresolved.token);
  return (
    <div className="absolute inset-0 flex flex-col gap-2 bg-card p-6" role="alert" data-unresolved-screen="unknown">
      <div className="text-body font-medium text-foreground">{t('screen_unknown_title')}</div>
      <div className="text-label text-muted-foreground">
        {known
          ? t('screen_unknown_kit', { screen: known.label, kit: known.kit })
          : t('screen_unknown_body', { screen: unresolved.token })}
      </div>
      <div>
        <Button onClick={() => eventBus.emit('app/context/level/requested', { level: unresolved.level })}>
          {t('screen_unknown_home')}
        </Button>
      </div>
    </div>
  );
}
