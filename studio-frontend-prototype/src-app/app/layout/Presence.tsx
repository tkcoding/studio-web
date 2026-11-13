/**
 * The shell's half of presence (the prototype's `usePresence` and
 * `PresenceNotes`, `presence.tsx`): the heartbeat for the signed-in person, and
 * the notes left for them stacked in the corner until dismissed. Nothing
 * auto-hides — the note was not stored anywhere, so a toast that faded while
 * somebody looked at another window would be the only copy disappearing.
 */

import React, { useEffect, useState } from 'react';
import { useAppSelector, type HeaderState } from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit/button';
import { X } from 'lucide-react';
import { useShellText } from '@/app/i18n/shellTranslations';
import { ago } from '@/app/live/completedWork';
import { placeOf, usePresence } from '@/app/presence/presence';
import type { PresenceNote } from '@/app/api/PresenceApiService';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import { useScreenLevel } from './useScreenLevel';

export const Presence: React.FC = () => {
  const user = useAppSelector((state) => (state['layout/header'] as HeaderState | undefined)?.user);
  const context = useAppSelector((state) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined);
  const level = useScreenLevel();
  const where = placeOf({ section: context?.section, level, project: context?.project, workspace: context?.workspace });
  const { notes, dismiss } = usePresence({ displayName: user?.displayName || user?.email || undefined, ...where });
  return <PresenceNotes notes={notes} onDismiss={dismiss} />;
};

Presence.displayName = 'Presence';

export const PresenceNotes: React.FC<{ notes: PresenceNote[]; onDismiss: (id: string) => void; now?: number }> = ({
  notes,
  onDismiss,
  now,
}) => {
  const t = useShellText();
  // The clock the ages are read against, moved on while notes are on screen.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (notes.length === 0) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [notes.length]);
  if (notes.length === 0) return null;
  const when = (atMs: number): string => {
    const { unit, count } = ago(atMs, now ?? Math.max(clock, atMs));
    return unit === 'now' ? t('work_inbox_just_now') : t(`work_inbox_ago_${unit}`, { count });
  };
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('presence_notes')}
      className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      data-presence-notes
    >
      {notes.map((n) => (
        <div key={n.id} className="rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg" data-presence-note={n.id}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium">{n.from_display_name || n.from_user_id}</span>
            <span className="text-label text-muted-foreground">{when(n.sent_ms)}</span>
            <Button
              variant="ghost"
              aria-label={t('presence_dismiss')}
              title={t('presence_dismiss')}
              onClick={() => onDismiss(n.id)}
              icon={<X aria-hidden="true" />}
            />
          </div>
          <p className="mt-1 whitespace-pre-wrap text-body">{n.text}</p>
        </div>
      ))}
    </div>
  );
};

PresenceNotes.displayName = 'PresenceNotes';
