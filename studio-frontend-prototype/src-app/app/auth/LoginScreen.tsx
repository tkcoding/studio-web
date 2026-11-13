/**
 * Sign-in screen — the prototype's front door, carried over (ADR-0069).
 *
 * One centred column on a dark field: the mark, the headline, and a panel
 * with e-mail and password on the left and GitHub on the right. The password
 * goes from here to the IdP's token endpoint (`login({ type: 'password' })`);
 * whatever that grant cannot finish continues on the IdP's own page with the
 * e-mail filled in. GitHub goes through Keycloak with `kc_idp_hint`, so no
 * Keycloak page is drawn on the way.
 *
 * Lives in the light DOM with its own stylesheet: the art is literal colours
 * for the dark field in both themes (see LoginScreen.css).
 *
 * The collapsed developer path accepts a static token for the backend's
 * static-auth profiles and validates it against /me first. It exists only in
 * dev builds — Vite eliminates the branch from production bundles.
 */

import React, { useState } from 'react';
import { useFrontX } from '@gears-frontx/react';
import type { AuthLoginInput } from '@gears-frontx/auth';
import { ACCOUNTS_API_BASE_URL } from '@constructor-studio/mfe-shared';
import { keycloakOidcProvider, PasswordRejectedError } from './keycloakOidcProvider';
import './LoginScreen.css';

const PRODUCT_MARK = '/constructor-symbol.svg';

export interface LoginScreenProps {
  sessionExpired?: boolean;
  initialError?: string;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const GitHubGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C19.3 4.7 20.3 5 20.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z" />
  </svg>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({ sessionExpired, initialError }) => {
  const { auth } = useFrontX();
  const [error, setError] = useState<string | undefined>(
    initialError ?? (sessionExpired ? 'Session expired — please sign in again.' : undefined)
  );
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'sign-in' | 'create'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // DEV-gated so the default token string is eliminated from prod bundles.
  const [devToken, setDevToken] = useState(import.meta.env.DEV ? 'studio-admin-token' : '');

  /** A login that may hand the browser to the IdP. */
  const run = async (input: AuthLoginInput) => {
    setBusy(true);
    setError(undefined);
    try {
      const transition = await auth?.login?.(input);
      if (transition?.type === 'redirect') {
        window.location.href = transition.redirectUrl;
        return; // navigating away
      }
    } catch (e) {
      setError(e instanceof PasswordRejectedError ? e.message : message(e));
    }
    setBusy(false);
  };

  const github = () => void run({ type: 'oauth', payload: { idpHint: 'github' } });

  const signIn = (event: React.FormEvent) => {
    event.preventDefault();
    void run({ type: 'password', payload: { username: email.trim(), password } });
  };

  const forgotPassword = () => {
    window.location.href = keycloakOidcProvider.resetPasswordUrl();
  };

  const devSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = devToken.trim();
    if (!token) return;
    setBusy(true);
    setError(undefined);
    try {
      // Validate before establishing the session, so a typo'd token never
      // momentarily mounts the authenticated app.
      const res = await fetch(`${ACCOUNTS_API_BASE_URL}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError(res.status === 401 ? 'Invalid token' : `Sign-in failed: HTTP ${res.status}`);
        return;
      }
      await auth?.login?.({ type: 'static-token', payload: { token } });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const githubButton = (
    <button
      type="button"
      className="auth-provider"
      title="GitHub (via Keycloak identity federation)"
      disabled={busy}
      onClick={github}
    >
      <GitHubGlyph />
      GitHub
    </button>
  );

  return (
    <div className="auth-shell">
      <div className="auth-column">
        <p className="auth-brand">
          <img src={PRODUCT_MARK} alt="" width={24} height={24} />
          Constructor Studio
        </p>
        <h1 className="auth-title">
          Open-source <span className="auth-accent">AI fabric</span> <br />
          for Software as a Service.
        </h1>

        <div className="auth-panel">
          <div className="auth-local">
            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'sign-in'}
                className={tab === 'sign-in' ? 'active' : ''}
                onClick={() => setTab('sign-in')}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'create'}
                className={tab === 'create' ? 'active' : ''}
                onClick={() => setTab('create')}
              >
                Create account
              </button>
            </div>

            {tab === 'sign-in' ? (
              <form className="auth-form" onSubmit={signIn}>
                <label className="auth-field">
                  <span>Work email</span>
                  <input
                    type="text"
                    autoComplete="username"
                    placeholder="name@company.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field-head">
                    Password
                    <button type="button" className="auth-link" onClick={forgotPassword}>
                      Forgot password?
                    </button>
                  </span>
                  <span className="auth-password">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="auth-eye"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                        {!showPassword && <path d="m3 3 18 18" />}
                      </svg>
                    </button>
                  </span>
                </label>
                <button type="submit" className="auth-submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            ) : (
              // Studio accounts are not opened from a form: the first GitHub
              // sign-in creates the identity, and an organization owner then
              // lets it in. Saying so beats a form that ends in a refusal.
              <div className="auth-form">
                <p className="auth-copy">
                  Your Studio account is created the first time you sign in with GitHub. An
                  organization owner then invites you to its workspaces.
                </p>
                {githubButton}
              </div>
            )}

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            {import.meta.env.DEV && (
              <details className="auth-dev">
                <summary>Developer sign-in (static token)</summary>
                <form onSubmit={(e) => void devSignIn(e)}>
                  <input
                    value={devToken}
                    onChange={(e) => setDevToken(e.target.value)}
                    placeholder="static token"
                  />
                  <button type="submit" className="auth-provider" disabled={busy} style={{ width: 'auto' }}>
                    Sign in
                  </button>
                </form>
              </details>
            )}
          </div>

          <div className="auth-federated">
            <p className="auth-kicker">Or continue with</p>
            {githubButton}
          </div>
        </div>
      </div>
    </div>
  );
};

LoginScreen.displayName = 'LoginScreen';
