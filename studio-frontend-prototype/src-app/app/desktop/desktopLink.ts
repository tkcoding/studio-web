/**
 * The desktop hand-off (ADR-0027 §6), the old prototype's `open-in-desktop.tsx`
 * apart from React: the link the desktop Studio opens a project with, and who
 * has the project open on a desktop.
 *
 * The link names this Studio and the project and carries no token — the app
 * signs the member in itself and clones through Studio. The Studio is named by
 * this portal's address and by the realm it signs in with, since the desktop's
 * list may know this Studio by another address and the realm is what both
 * agree on. Mirrors `theia/studio/src/common/desktop-link.ts`, which reads it.
 */

/** Where the desktop installer is published: the repository's desktop pre-releases. */
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/constructorfabric/studio-web/releases?q=desktop-v&expanded=true';

/** How long the app has to take the focus before the page says it may be missing. */
export const NO_APP_AFTER_MS = 1500;

/** `DesktopSessionDto`: one desktop a project is open on. */
export interface DesktopSession {
  id: string;
  workspace_id: string;
  /** Token subject of whoever has it open. */
  member_id: string;
  device_id: string;
  device_name?: string | null;
  started_at_epoch_secs: number;
  last_seen_epoch_secs: number;
  expires_at_epoch_secs: number;
  heartbeat_secs: number;
}

export function desktopLink(
  project: { id: string; name?: string },
  studio: { origin: string; issuer: string }
): string {
  const params = new URLSearchParams();
  params.set('studio', studio.origin);
  params.set('issuer', studio.issuer.replace(/\/+$/, ''));
  params.set('project', project.id);
  if (project.name) params.set('name', project.name);
  return `cfstudio://open?${params.toString()}`;
}

/** The desktops a project is open on, each named, the member's own marked. Empty for none. */
export function desktopNames(
  sessions: readonly DesktopSession[],
  me: string | undefined,
  text: { unnamed: string; you: (device: string) => string }
): string[] {
  return sessions.map((session) => {
    const device = session.device_name?.trim() || text.unnamed;
    return session.member_id === me ? text.you(device) : device;
  });
}

/** The member's own desktop a file should open on: the one heard from last. */
export function myDesktop(sessions: readonly DesktopSession[], me: string | undefined): DesktopSession | undefined {
  if (!me) return undefined;
  return sessions
    .filter((session) => session.member_id === me)
    .sort((a, b) => b.last_seen_epoch_secs - a.last_seen_epoch_secs)[0];
}
