/**
 * What every screen of the Components kit shares: the text function, the
 * gear's own words for a refusal, waiting on a `studio-tasks` run, and who the
 * caller is (a platform administrator's home is the platform root).
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { apiRegistry, type ChildMfeBridge } from '@gears-frontx/react';
import { AccountsApiService, errorMessage, refusalText, responseStatus } from '@constructor-studio/mfe-shared';
import { ComponentsApiService } from '../../api/ComponentsApiService';
import type { TaskRun } from '../../api/types';
import { syncLine } from '../../model/catalogue';
import type { useComponentsTranslations } from '../../i18n';

export type Text = ReturnType<typeof useComponentsTranslations>['t'];

/** The platform's root tenant: a platform administrator's home. */
export const PLATFORM_ROOT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** The gear's own words for a refusal, else the error's message. */
export const errText = (e: unknown): string => refusalText(e) ?? errorMessage(e);

/** The HTTP status of a failed call, when it got an answer. */
export const statusOf = (e: unknown): number | undefined => responseStatus(e);

export const api = (): ComponentsApiService => apiRegistry.getService(ComponentsApiService);

/** What a screen needs from where it is mounted. */
export interface Scope {
  /** The organization on screen; null on a level without one. */
  org: { id: string; name: string } | null;
  /** Whether the caller is a platform administrator. */
  platformAdmin: boolean;
  t: Text;
  /** The screen's language, for dates. */
  language: string;
  /** To open another screen of the portal. */
  bridge: ChildMfeBridge;
  /** Where dialogs portal: inside the themed shadow root. */
  container: React.RefObject<HTMLDivElement | null>;
}

export const ScopeContext = createContext<Scope | null>(null);

export function useScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useScope outside the Components screen');
  return scope;
}

/** Whether the caller's home is the platform root; false until known, and on a failed read. */
export function usePlatformAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(AccountsApiService)
      .getMe.fetch()
      .then((me) => {
        if (live) setAdmin(me?.subject_tenant_id === PLATFORM_ROOT_TENANT_ID);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return admin;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a catalogue sync run, reporting each reading: every 1.5 s, for up
 * to ten minutes (the prototype's loop). `tenant` is where it was queued —
 * the organization on screen, or null for the caller's home (the platform's
 * own sync). Resolves with the last line and whether it ended well.
 */
export async function waitForSync(
  runId: string,
  tenant: string | null,
  onLine: (line: { done: boolean; ok: boolean; text: string }) => void,
  pause: (ms: number) => Promise<void> = sleep,
): Promise<{ done: boolean; ok: boolean; text: string }> {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    await pause(1500);
    const run: TaskRun = await api().taskRun({ runId, tenant }).fetch({ staleTime: 0 });
    const line = syncLine(run);
    onLine(line);
    if (line.done) return line;
    if (Date.now() > deadline) {
      const timedOut = { done: true, ok: false, text: 'timed out — still running server-side' };
      onLine(timedOut);
      return timedOut;
    }
  }
}
