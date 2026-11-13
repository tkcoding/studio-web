// The callbackParams cases are the prototype's (src/sign-in-connection.test.ts at 00828880), unchanged.
import { afterEach, describe, expect, it } from 'vitest';

import { callbackParams, rememberSignInReturn, takeSignInReturn } from './connectionSignIn';

describe('callbackParams', () => {
  it('reads the state and the code the identity provider sent back', () => {
    expect(callbackParams('?code=abc&state=0123&session_state=x')).toEqual({
      kind: 'code',
      state: '0123',
      code: 'abc',
    });
  });

  it('says plainly that a cancelled sign-in was cancelled', () => {
    expect(callbackParams('?error=access_denied&state=0123')).toEqual({
      kind: 'refused',
      reason: 'The sign-in was cancelled.',
    });
  });

  it('passes on what the provider said about any other refusal', () => {
    expect(callbackParams('?error=invalid_scope&error_description=Unknown+scope')).toEqual({
      kind: 'refused',
      reason: 'Unknown scope',
    });
  });

  it('has nothing to finish without both a state and a code', () => {
    expect(callbackParams('?code=abc')).toEqual({ kind: 'empty' });
    expect(callbackParams('')).toEqual({ kind: 'empty' });
  });
});

describe('the return address', () => {
  afterEach(() => sessionStorage.clear());

  it('comes back once, with the shell’s query and fragment', () => {
    rememberSignInReturn({ pathname: '/', search: '?screen=admin;org=o1;section=integrations', hash: '#x' });
    expect(takeSignInReturn()).toBe('/?screen=admin;org=o1;section=integrations#x');
    expect(takeSignInReturn()).toBe('/');
  });

  it('never points off the site', () => {
    sessionStorage.setItem('studio.connection-sign-in.return', '//evil.example/');
    expect(takeSignInReturn()).toBe('/');
    sessionStorage.setItem('studio.connection-sign-in.return', 'https://evil.example/');
    expect(takeSignInReturn()).toBe('/');
  });
});
