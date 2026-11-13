// @cpt-flow:cpt-frontx-flow-framework-composition-app-bootstrap:p1

/**
 * Bootstrap Effects
 *
 * Effects for app-level bootstrap operations.
 * Following flux architecture: Listen to events from actions, dispatch to slices.
 */

import { eventBus, setUser, setHeaderLoading, apiRegistry, type FrontXApp } from '@gears-frontx/react';
import { publishSessionProfile } from '@/app/mfe/sharedContext';
import { setSessionProfile, type SessionProfile } from '@/app/slices/appSessionSlice';
import { AccountsApiService } from '@constructor-studio/mfe-shared';
import { IdentityApiService } from '@/app/api/IdentityApiService';
import { setMfeBootstrapStatus } from '@/app/slices/mfeBootstrapSlice';

/**
 * Header identity assembly: display data (name, email) comes from the token
 * claims; the /me call is the backend's confirmation of whom the token
 * authenticates as, and its subject id is the display fallback for tokens
 * without profile claims (static dev tokens).
 */
function claimString(claims: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = claims?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** The caller's Studio person, or null when studio-user is not there or does not answer. */
async function personSummary() {
  if (!apiRegistry.has(IdentityApiService)) return null;
  try {
    return await apiRegistry.getService(IdentityApiService).myPerson.fetch({ staleTime: 0 });
  } catch {
    return null;
  }
}

/**
 * Register bootstrap effects
 * Called once during app initialization. Takes the app instance so identity
 * flows through the framework auth runtime, not a concrete provider.
 */
// @cpt-begin:cpt-frontx-flow-framework-composition-app-bootstrap:p1:inst-1
export function registerBootstrapEffects(app: FrontXApp): void {
  const dispatch = app.store.dispatch;

  // Mirror the MFE bootstrap status into the store so the menu can tell
  // "still loading" from "no screens registered".
  eventBus.on('app/mfe/bootstrap', ({ status }) => {
    dispatch(setMfeBootstrapStatus(status));
  });

  // Listen for 'app/user/fetch' event
  eventBus.on('app/user/fetch', async () => {
    let headerLoadingStarted = false;
    try {
      // Check if accounts service is registered before trying to use it
      if (!apiRegistry.has(AccountsApiService)) {
        // Accounts service not registered - skip user fetch
        return;
      }

      dispatch(setHeaderLoading(true));
      headerLoadingStarted = true;

      // The person Studio keeps is asked for beside `/me`, not after it: it
      // does not depend on it, and it never fails (null instead).
      const personRead = personSummary();
      // Get accounts service using class-based registration
      const accountsService = apiRegistry.getService(AccountsApiService);
      const me = await accountsService.getMe.fetch();
      const identity = (await app.auth?.getIdentity?.()) ?? null;
      const claims = identity?.claims as Record<string, unknown> | undefined;
      const displayName =
        claimString(claims, 'name') ??
        claimString(claims, 'preferred_username') ??
        (me?.subject_id ? `${me.subject_id.slice(0, 8)}…` : undefined);
      const email = claimString(claims, 'email');
      dispatch(setUser({ displayName, email }));
      // The account button shows the person Studio keeps — the name and photo they
      // chose in Profile, or the picture a GitHub sign-in brought — as the prototype's
      // did. Without studio-user it stays on the token's words.
      void personRead.then((person) => {
        const avatarUrl = person?.avatar_url?.trim();
        const name = person?.display_name?.trim();
        if (avatarUrl || name) {
          dispatch(setUser({ displayName: name || displayName, email, ...(avatarUrl ? { avatarUrl } : {}) }));
        }
      });
      if (me?.subject_id) {
        const profile: SessionProfile = { id: me.subject_id };
        if (displayName) profile.displayName = displayName;
        if (email) profile.email = email;
        dispatch(setSessionProfile(profile));
        publishSessionProfile(app);
      }
    } catch (error) {
      // Log the message only: an AxiosError carries the request config,
      // Authorization header included — the raw object would print the token.
      console.warn('Failed to fetch user:', error instanceof Error ? error.message : String(error));
    } finally {
      if (headerLoadingStarted) {
        dispatch(setHeaderLoading(false));
      }
    }
  });
}
// @cpt-end:cpt-frontx-flow-framework-composition-app-bootstrap:p1:inst-1
