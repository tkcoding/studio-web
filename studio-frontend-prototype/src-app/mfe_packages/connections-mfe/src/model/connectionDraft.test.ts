import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, isDraftUsable, toCreateBody } from './connectionDraft';

const FILLED = { ...EMPTY_DRAFT, provider: 'github', label: 'GitHub', token: 'ghp_x' };

describe('draft completeness', () => {
  it('needs a provider, a label and a credential', () => {
    expect(isDraftUsable(FILLED)).toBe(true);
    expect(isDraftUsable({ ...FILLED, provider: '' })).toBe(false);
    expect(isDraftUsable({ ...FILLED, label: '   ' })).toBe(false);
    expect(isDraftUsable({ ...FILLED, token: '' })).toBe(false);
  });

  it('does not require a base URL — the gear has a default for every provider', () => {
    expect(isDraftUsable({ ...FILLED, baseUrl: '' })).toBe(true);
  });
});

describe('request body', () => {
  it('sends organization scope and the owner tenant, neither of them asked for', () => {
    expect(toCreateBody(FILLED, 'org-1')).toEqual({
      provider: 'github',
      label: 'GitHub',
      token: 'ghp_x',
      scope: 'organization',
      owner_tenant_id: 'org-1',
    });
  });

  it('omits an empty base URL instead of sending one, so the gear applies its default', () => {
    expect(toCreateBody({ ...FILLED, baseUrl: '  ' }, 'org-1')).not.toHaveProperty('base_url');
  });

  it('passes a given base URL through, trimmed', () => {
    expect(toCreateBody({ ...FILLED, baseUrl: ' https://ghe.corp ' }, 'org-1').base_url).toBe(
      'https://ghe.corp'
    );
  });

  it('trims the label, because the gear stores what it is sent', () => {
    expect(toCreateBody({ ...FILLED, label: '  GitHub  ' }, 'org-1').label).toBe('GitHub');
  });
});
