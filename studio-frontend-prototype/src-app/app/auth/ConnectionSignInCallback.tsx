/**
 * The page a connection made by signing in comes back to (ADR-0049) — the
 * prototype's `SignInCallback` (`sign-in-connection.tsx` at 00828880).
 * Admin › Integrations sends the person to the provider's identity provider
 * with `/connections/oauth/callback` as the return address; this page hands
 * what came back to studio-connector, then returns to where the sign-in
 * started. It renders in place of the layout, so the router never reads the
 * address, and `AuthGate` leaves its `code` and `state` alone: they are the
 * connection's, not the portal's own sign-in.
 */

import React, { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  ConnectorsApiService,
  SIGN_IN_CALLBACK_PATH,
  callbackParams,
  errorMessage,
  refusalText,
  takeSignInReturn,
  type CallbackParams,
  type ConnectionTestDto,
} from '@constructor-studio/mfe-shared';

/** Whether the address is the callback page. */
export function isConnectionSignInCallback(pathname: string = window.location.pathname): boolean {
  return pathname === SIGN_IN_CALLBACK_PATH;
}

type Outcome = { kind: 'working' } | { kind: 'done'; test: ConnectionTestDto } | { kind: 'failed'; reason: string };

// The code is single-use; read once, before anything can rewrite the address.
let arrived: CallbackParams | null = null;
function takeArrival(): CallbackParams {
  if (!arrived) {
    arrived = callbackParams(window.location.search);
    window.history.replaceState({}, document.title, SIGN_IN_CALLBACK_PATH);
  }
  return arrived;
}

export const ConnectionSignInCallback: React.FC = () => {
  const [params] = useState(takeArrival);
  const [back] = useState(takeSignInReturn);
  const [outcome, setOutcome] = useState<Outcome>(() =>
    params.kind === 'refused'
      ? { kind: 'failed', reason: params.reason }
      : params.kind === 'empty'
        ? { kind: 'failed', reason: 'Nothing came back from the sign-in. Start it again.' }
        : { kind: 'working' }
  );

  useEffect(() => {
    if (params.kind !== 'code') return;
    let live = true;
    apiRegistry
      .getService(ConnectorsApiService)
      .completeSignIn.fetch({ state: params.state, code: params.code })
      .then(
        (test) => live && setOutcome({ kind: 'done', test }),
        (e: unknown) => live && setOutcome({ kind: 'failed', reason: refusalText(e) ?? errorMessage(e) })
      );
    return () => {
      live = false;
    };
  }, [params]);

  useEffect(() => {
    if (outcome.kind !== 'done') return;
    const timer = window.setTimeout(() => window.location.assign(back), 1500);
    return () => window.clearTimeout(timer);
  }, [outcome, back]);

  return (
    <main className="flex h-full items-center justify-center p-6" data-connection-sign-in-callback>
      <div className="flex max-w-lg flex-col gap-3 rounded-lg border border-border p-6 text-sm">
        <h2 className="text-lg font-semibold">Connecting your account</h2>
        {outcome.kind === 'working' && <p className="text-muted-foreground">Finishing the sign-in…</p>}
        {outcome.kind === 'done' && (
          <p>
            Connected {outcome.test.connection.label} as{' '}
            <strong>{outcome.test.display_name ?? outcome.test.account}</strong>. Taking you back…
          </p>
        )}
        {outcome.kind === 'failed' && (
          <p role="alert" className="text-destructive">
            {outcome.reason}
          </p>
        )}
        <p>
          <a className="underline" href={back}>
            ← Back
          </a>
        </p>
      </div>
    </main>
  );
};

ConnectionSignInCallback.displayName = 'ConnectionSignInCallback';
