/**
 * Project › Hello: the demo kit's one screen. It says where it came from and
 * which project it is shown in, read from the shell's shared context like any
 * kit screen.
 */

import type { ChildMfeBridge } from '@gears-frontx/react';
import { useSharedProperty, FRONTX_SHARED_PROPERTY_LANGUAGE } from '@gears-frontx/react';
import { Card, CardContent, CardHeader, CardTitle } from '@gears-frontx/ui-kit';
import { STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT } from '@constructor-studio/mfe-shared';

const TEXT = {
  en: {
    title: 'Hello from a kit',
    body: 'This tab is the hello-kit bundle, loaded when the kit was installed. The portal was not rebuilt for it.',
    project: 'Project',
    none: 'none',
  },
  ru: {
    title: 'Привет из кита',
    body: 'Эта вкладка — бандл hello-kit, загруженный после установки кита. Портал для неё не пересобирали.',
    project: 'Проект',
    none: 'нет',
  },
} as const;

export function HelloScreen({ bridge }: { bridge: ChildMfeBridge }) {
  const language = useSharedProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, { bridge });
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, { bridge });
  const t = language === 'ru' ? TEXT.ru : TEXT.en;
  return (
    <div style={{ padding: 'var(--space-6, 24px)' }} data-hello-kit>
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{t.body}</p>
          <p style={{ color: 'var(--muted-foreground)' }}>
            {t.project}: {typeof project === 'string' && project ? project : t.none}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
