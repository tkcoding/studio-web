/**
 * The demo kit's contributions into other screens' slots (`mfe/slots.ts` in
 * the shell): a panel on Project › Overview (`screen.panels`) and a chip
 * beside the open project in the path bar (`project.header.status`). Each is
 * its own entry, mounted into its own shadow root; the shell orders them and
 * keeps a failure of one from touching the others.
 */

import type { ChildMfeBridge } from '@gears-frontx/react';
import { useSharedProperty, FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';
import { Badge, Card, CardContent } from '@gears-frontx/ui-kit';

const TEXT = {
  en: {
    panel: 'A panel from hello-kit: a kit can add to a screen it does not own.',
    chip: 'hello-kit',
  },
  ru: {
    panel: 'Панель из hello-kit: кит может добавить своё в чужой экран.',
    chip: 'hello-kit',
  },
} as const;

function useText(bridge: ChildMfeBridge) {
  const language = useSharedProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, { bridge });
  return language === 'ru' ? TEXT.ru : TEXT.en;
}

export function HelloPanel({ bridge }: { bridge: ChildMfeBridge }) {
  const t = useText(bridge);
  return (
    <Card data-hello-kit-panel>
      <CardContent style={{ padding: 'var(--space-4, 16px)' }}>{t.panel}</CardContent>
    </Card>
  );
}

export function HelloStatus({ bridge }: { bridge: ChildMfeBridge }) {
  const t = useText(bridge);
  return (
    <Badge variant="secondary" data-hello-kit-status>
      {t.chip}
    </Badge>
  );
}
