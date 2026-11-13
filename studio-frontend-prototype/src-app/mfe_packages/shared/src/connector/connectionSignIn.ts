// From the prototype's src/sign-in-connection.tsx at 00828880: the callback address, what the identity provider
// put on it (`callbackParams`, unchanged) and where to return to. Shared because both halves need it: an MFE starts
// the sign-in (Admin › Integrations), the shell answers the callback page.
//
// A connection made by signing in rather than by pasting a credential (ADR-0049): Constructor Research. The portal
// sends the person to the provider's identity provider, which sends them back to the callback page with `state` and
// `code`; the backend does the rest. All this side carries across the round trip is where to return to.

/** Where the identity provider sends the person back. Studio's client is registered with exactly this address. */
export const SIGN_IN_CALLBACK_PATH = '/connections/oauth/callback';

const RETURN_KEY = 'studio.connection-sign-in.return';

/** What the identity provider put on the callback address. */
export type CallbackParams =
  | { kind: 'code'; state: string; code: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'empty' };

export function callbackParams(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  const error = q.get('error');
  if (error) {
    const description = q.get('error_description');
    return {
      kind: 'refused',
      reason: error === 'access_denied' ? 'The sign-in was cancelled.' : description || error,
    };
  }
  const state = q.get('state');
  const code = q.get('code');
  return state && code ? { kind: 'code', state, code } : { kind: 'empty' };
}

/** Remember where the sign-in started: the shell's address is its path, query and fragment. */
export function rememberSignInReturn(location: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location): void {
  try {
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search + location.hash);
  } catch {
    // Without storage the person comes back to the start page; nothing is lost.
  }
}

/** Where to go back to, once; only a path on this site, never somewhere a stored value could point. */
export function takeSignInReturn(): string {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : '/';
  } catch {
    return '/';
  }
}
