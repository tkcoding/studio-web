import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { login: vi.fn() },
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ auth: mockAuth }),
}));

import { LoginScreen } from './LoginScreen';

const fetchMock = vi.fn();

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    mockAuth.login.mockResolvedValue({ type: 'none' });
  });

  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('signs in with the e-mail and password through the auth runtime', async () => {
    render(<LoginScreen />);
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: ' ann@example.com ' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByPlaceholderText('name@company.com').closest('form')!);
    await waitFor(() =>
      expect(mockAuth.login).toHaveBeenCalledWith({
        type: 'password',
        payload: { username: 'ann@example.com', password: 'secret' },
      })
    );
  });

  it('says a refused password on the page', async () => {
    const { PasswordRejectedError } = await import('./keycloakOidcProvider');
    mockAuth.login.mockRejectedValue(new PasswordRejectedError('Wrong email or password.'));
    render(<LoginScreen />);
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: 'ann' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByPlaceholderText('name@company.com').closest('form')!);
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();
  });

  it('goes to GitHub through the IdP hint', async () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getAllByRole('button', { name: /GitHub/ })[0]);
    await waitFor(() =>
      expect(mockAuth.login).toHaveBeenCalledWith({ type: 'oauth', payload: { idpHint: 'github' } })
    );
  });

  it('shows the session-expired notice', () => {
    render(<LoginScreen sessionExpired />);
    expect(screen.getByText(/Session expired/)).toBeTruthy();
  });

  it('hides the static-token panel outside dev builds', () => {
    vi.stubEnv('DEV', false);
    render(<LoginScreen />);
    expect(screen.queryByText(/Developer sign-in/)).toBeNull();
  });

  it('validates the static token against /me before establishing a session', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    render(<LoginScreen />);

    fireEvent.submit(screen.getByText(/Developer sign-in/).closest('details')!.querySelector('form')!);

    expect(await screen.findByText('Invalid token')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/cf/account-management/v1/me');
    expect((init.headers as Record<string, string>).Authorization).toContain('Bearer');
    // A rejected probe must never reach login().
    expect(mockAuth.login).not.toHaveBeenCalled();
  });

  it('establishes the static session after a successful /me probe', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    render(<LoginScreen />);

    fireEvent.submit(screen.getByText(/Developer sign-in/).closest('details')!.querySelector('form')!);

    await waitFor(() =>
      expect(mockAuth.login).toHaveBeenCalledWith({
        type: 'static-token',
        payload: { token: 'studio-admin-token' },
      })
    );
  });
});
