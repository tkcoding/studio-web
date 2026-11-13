import { describe, expect, it } from 'vitest';
import { Github, Plug, Slack, Webhook } from 'lucide-react';
import type { ConnectionDto } from '@constructor-studio/mfe-shared';
import { healthTone, iconFor, matchesQuery, type ConnectionRow } from './connection';

describe('provider glyphs', () => {
  it('draws a known provider with its own icon', () => {
    expect(iconFor('github')).toBe(Github);
    expect(iconFor('slack')).toBe(Slack);
  });

  it('draws every webhook variant as a webhook, not as its platform', () => {
    // The row names the provider already; the glyph is there to say which of
    // the two credentials this connection holds.
    for (const code of ['slack_webhook', 'zulip_webhook', 'discord_webhook']) {
      expect(iconFor(code)).toBe(Webhook);
    }
  });

  it('falls back rather than failing on a provider newer than this screen', () => {
    expect(iconFor('perforce')).toBe(Plug);
  });
});

describe('health tone', () => {
  it('maps each state to the badge variant the design uses', () => {
    expect(healthTone('healthy')).toBe('success');
    expect(healthTone('unusable')).toBe('warning');
  });
});

function row(over: Partial<ConnectionDto>, providerName = 'GitHub'): ConnectionRow {
  const connection: ConnectionDto = {
    id: 'c-1',
    owner_tenant_id: 'org-1',
    provider: 'gh',
    label: 'Platform GitHub',
    account: 'constructorfabric',
    base_url: 'https://api.github.com',
    scope: 'organization',
    secret_ref: 'ref',
    created_at_epoch_secs: 1_700_000_000,
    ...over,
  };
  return { id: connection.id, connection, providerName };
}

describe('toolbar search', () => {
  it('keeps every row when nothing is typed', () => {
    expect(matchesQuery(row({}), '   ')).toBe(true);
  });

  it('matches the connection name', () => {
    expect(matchesQuery(row({}), 'platform')).toBe(true);
  });

  it('matches the account, which is what tells two GitHub rows apart', () => {
    expect(matchesQuery(row({ label: 'A' }), 'constructorfabric')).toBe(true);
  });

  it('matches the provider by its display name', () => {
    expect(matchesQuery(row({ label: 'A', account: 'b' }), 'hub')).toBe(true);
  });

  it('matches the provider by its wire key', () => {
    expect(matchesQuery(row({ label: 'A', account: 'b' }), 'gh')).toBe(true);
  });

  it('drops a row nothing in it matches', () => {
    expect(matchesQuery(row({}), 'gitlab')).toBe(false);
  });
});
