/**
 * Presence: say we are here, and surface anything left for us — the
 * prototype's `usePresence` (`presence.tsx`).
 *
 * The heartbeat is what makes anybody appear in Admin › System's list, and the
 * same request collects the notes written to the person: a client that has to
 * be here anyway to report presence needs no second request to learn it was
 * written to. A note is not a chat: it reaches somebody in Studio now, within
 * one heartbeat, and is not stored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { PresenceApiService, type PresenceNote } from '@/app/api/PresenceApiService';

/** How often we report in. The server judges by three of these, so missing one to a sleeping laptop costs nothing. */
export const BEAT_MS = 30_000;

/** How long a place has to hold before a move is reported: the places a load or a click passes through are not reported. */
export const PLACE_SETTLE_MS = 750;

/** Notes arrive appended: the heartbeat hands each over exactly once, so what is on screen is the only copy. */
export function appendNotes(current: readonly PresenceNote[], arrived: readonly PresenceNote[]): PresenceNote[] {
  if (arrived.length === 0) return current as PresenceNote[];
  const known = new Set(current.map((n) => n.id));
  return [...current, ...arrived.filter((n) => !known.has(n.id))];
}

export function dismissNote(current: readonly PresenceNote[], id: string): PresenceNote[] {
  return current.filter((n) => n.id !== id);
}

/** What the heartbeat says about where the person is: the section on screen (else the level), and the project or workspace. */
export function placeOf(context: {
  section?: string | null;
  level?: string | null;
  project?: { name: string } | null;
  workspace?: { name: string } | null;
}): { place: string; detail?: string } {
  const place = context.section || context.level || 'studio';
  const detail = context.project?.name || context.workspace?.name || undefined;
  return detail ? { place, detail } : { place };
}

export interface PresenceClient {
  beat(body: { display_name?: string; place?: string; detail?: string }): Promise<{ messages: PresenceNote[]; online: number }>;
  leave(): Promise<unknown>;
}

function registryClient(): PresenceClient | null {
  if (!apiRegistry.has(PresenceApiService)) return null;
  const api = apiRegistry.getService(PresenceApiService);
  return {
    beat: (body) => api.heartbeat.fetch(body),
    leave: () => api.leave.fetch(undefined),
  };
}

/**
 * Report in every BEAT_MS, and at once when the place changes, so the list
 * follows the person rather than trailing half a minute behind. Leaves on
 * `pagehide` and on unmount, best-effort: a killed tab never does, which is why
 * the server also has a timeout. Failures are silent — presence is a nicety, and
 * a backend without the gear must not put an error on a working screen.
 */
export function usePresence(
  who: { displayName?: string; place: string; detail?: string },
  client: PresenceClient | null = registryClient()
): { notes: PresenceNote[]; dismiss: (id: string) => void; online: number } {
  const [notes, setNotes] = useState<PresenceNote[]>([]);
  const [online, setOnline] = useState(0);
  // Held in a ref so a move does not restart the timer — only what the next beat says.
  const where = useRef(who);
  const api = useRef(client);
  useEffect(() => {
    where.current = who;
    api.current = client;
  });
  const enabled = client !== null;

  const beat = useCallback(async () => {
    const c = api.current;
    if (!c) return;
    try {
      const { displayName, place, detail } = where.current;
      const r = await c.beat({ display_name: displayName, place, detail });
      setOnline(r.online);
      setNotes((current) => appendNotes(current, r.messages ?? []));
    } catch {
      // A backend without the gear, or a blip.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => void beat(), BEAT_MS);
    const leave = () => void api.current?.leave().catch(() => undefined);
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [beat, enabled]);

  // The first beat, and one more whenever the person moves — once the place
  // has settled. Opening the portal walks it through two or three places in
  // its first second ('studio', the level, the section), and each used to cost
  // a POST of its own.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => void beat(), PLACE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [beat, enabled, who.place, who.detail]);

  const dismiss = useCallback((id: string) => setNotes((current) => dismissNote(current, id)), []);
  return { notes, dismiss, online };
}
