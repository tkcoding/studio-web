/**
 * The editor's bar: what the old prototype put beside an open IDE space —
 * Reload (a fresh frame, the session keeps running), Stop (the session ends
 * and releases what it holds, asked first), and Desktop app (the project in the
 * desktop Studio, ADR-0027 §6) with where the project is open on desktops now.
 *
 * Not carried: "open in tab" — the session's address carries its gate's token,
 * which the shell keeps out of every address bar; and one tab per open
 * session — the shell has one editor, the project in scope's.
 */

import { useEffect, useRef, useState } from 'react';
import { apiRegistry, eventBus, useAppSelector } from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit/button';
import { DesktopApiService } from '@/app/api/DesktopApiService';
import { DESKTOP_DOWNLOAD_URL, NO_APP_AFTER_MS, desktopLink, desktopNames, type DesktopSession } from '@/app/desktop/desktopLink';
import { DEFAULT_ISSUER } from '@/app/auth/keycloakOidcProvider';
import { env } from '@/app/config/env';
import { useShellText } from '@/app/i18n/shellTranslations';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import { APP_SESSION_SLICE_KEY, type AppSessionState } from '@/app/slices/appSessionSlice';
import { EDITOR_SESSION_SLICE_KEY, type EditorSessionState } from '@/app/slices/editorSessionSlice';

/** How often the desktops are read when the backend does not say (its heartbeat). */
const DEFAULT_HEARTBEAT_SECS = 30;

/** The desktops a project is open on, re-read as often as they renew; none on a Studio without them. */
function useDesktopSessions(projectId: string | null): DesktopSession[] {
  const [sessions, setSessions] = useState<{ project: string; items: DesktopSession[] } | null>(null);
  useEffect(() => {
    if (!projectId || !apiRegistry.has(DesktopApiService)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      let every = DEFAULT_HEARTBEAT_SECS;
      try {
        const found =
          (await apiRegistry.getService(DesktopApiService).sessions({ projectId }).fetch({ staleTime: 0 }))?.items ?? [];
        if (!alive) return;
        setSessions({ project: projectId, items: found });
        every = found[0]?.heartbeat_secs ?? every;
      } catch {
        // Nothing to show, and no error: the button is still the way to open one.
        if (alive) setSessions({ project: projectId, items: [] });
      }
      if (alive) timer = setTimeout(() => void read(), every * 1000);
    };
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId]);
  return sessions && sessions.project === projectId ? sessions.items : [];
}

/** Hands a link to the desktop app, and notices when nothing took it: the app taking it takes the focus. */
function useDesktopLauncher(): { launch: (link: string) => void; missing: boolean } {
  const [missing, setMissing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const launch = (link: string) => {
    setMissing(false);
    clearTimeout(timer.current);
    const taken = () => clearTimeout(timer.current);
    window.addEventListener('blur', taken, { once: true });
    timer.current = setTimeout(() => {
      window.removeEventListener('blur', taken);
      setMissing(true);
    }, NO_APP_AFTER_MS);
    window.location.assign(link);
  };
  return { launch, missing };
}

export function EditorBar() {
  const t = useShellText();
  const session = useAppSelector((state) => state[EDITOR_SESSION_SLICE_KEY] as EditorSessionState | undefined);
  const project = useAppSelector(
    (state) => (state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined)?.project ?? null
  );
  const me = useAppSelector((state) => (state[APP_SESSION_SLICE_KEY] as AppSessionState | undefined)?.profile?.id);
  const desktops = useDesktopSessions(session?.shown ? (project?.id ?? null) : null);
  const { launch, missing } = useDesktopLauncher();
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);

  if (!session?.shown || !project) return null;
  const up = session.phase === 'ready' || session.phase === 'launching';
  const names = desktopNames(desktops, me, {
    unnamed: t('editor_desktop_unnamed'),
    you: (device) => t('editor_desktop_you', { device }),
  });

  const stop = async () => {
    setStopping(true);
    try {
      await new Promise<void>((resolve) => {
        eventBus.emit('app/editor/session/stop', { done: resolve });
      });
    } finally {
      setStopping(false);
      setConfirming(false);
    }
  };

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-label"
      data-editor-bar
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={!up}
        title={t('editor_reload_title')}
        onClick={() => eventBus.emit('app/editor/session/reload')}
      >
        {t('editor_reload')}
      </Button>
      {confirming ? (
        <span className="inline-flex items-center gap-2" data-editor-stop-confirm>
          <span className="text-muted-foreground">{t('editor_stop_confirm')}</span>
          <Button variant="destructive" size="sm" disabled={stopping} onClick={() => void stop()}>
            {t('editor_stop')}
          </Button>
          <Button variant="ghost" size="sm" disabled={stopping} onClick={() => setConfirming(false)}>
            {t('editor_stop_cancel')}
          </Button>
        </span>
      ) : (
        <Button variant="ghost" size="sm" disabled={!up} title={t('editor_stop_title')} onClick={() => setConfirming(true)}>
          {t('editor_stop')}
        </Button>
      )}
      <span className="ml-auto inline-flex flex-wrap items-center gap-2">
        {names.length > 0 && (
          <span className="text-muted-foreground" data-desktop-presence>
            {t('editor_desktop_open_on', { count: names.length, names: names.join(', ') })}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          title={t('editor_desktop_title')}
          data-open-desktop
          onClick={() =>
            launch(
              desktopLink(
                { id: project.id, name: project.name },
                { origin: window.location.origin, issuer: env.oidcIssuer ?? DEFAULT_ISSUER }
              )
            )
          }
        >
          {t('editor_desktop')}
        </Button>
        {missing && (
          <span className="text-muted-foreground" data-desktop-missing>
            {t('editor_desktop_missing')}{' '}
            <a className="underline" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
              {t('editor_desktop_get')}
            </a>
          </span>
        )}
      </span>
    </div>
  );
}
