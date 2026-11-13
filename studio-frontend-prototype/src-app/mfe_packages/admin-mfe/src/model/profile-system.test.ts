import { describe, expect, it } from 'vitest';
import {
  aliasConfidence,
  aliasKindLabel,
  avatarRefusal,
  confirmSummary,
  isStoredPhoto,
  loginProvider,
  photoProvider,
  primaryEmail,
  toBase64,
} from './profile';
import {
  asksTopic,
  countOf,
  entityRows,
  fixedTarget,
  gearsOf,
  isNotificationProvider,
  isReadFailure,
  messageBody,
  permissionParts,
  permissionsIn,
} from './system';
import { personalConnections, personalProviders, sharedConnections } from './connections';
import type { StoredConnection } from '../api/types';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

describe('profile', () => {
  it('puts the primary address first, else the typed one', () => {
    expect(
      primaryEmail({
        email: 'typed@x',
        emails: [
          { address: 'a@x', source: 'alias', verified: false, primary: false },
          { address: 'b@x', source: 'sign_in', verified: true, primary: true },
        ],
      })
    ).toBe('b@x');
    expect(primaryEmail({ email: ' typed@x ' })).toBe('typed@x');
    expect(primaryEmail({ email: '  ' })).toBeNull();
  });

  it('tells a stored photo from a linked one, and names GitHub', () => {
    const stored = `/cf/studio-user/v1/avatars/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/${'a'.repeat(64)}`;
    expect(isStoredPhoto(stored)).toBe(true);
    expect(isStoredPhoto('https://avatars.githubusercontent.com/u/1')).toBe(false);
    expect(photoProvider('https://avatars.githubusercontent.com/u/1')).toBe('GitHub');
    expect(photoProvider('https://example.com/me.png')).toBeNull();
    expect(photoProvider('not a url')).toBeNull();
  });

  it('refuses SVG and anything over 1 MiB', () => {
    expect(avatarRefusal({ type: 'image/svg+xml', size: 10 })).toEqual({ key: 'prof_photo_type' });
    expect(avatarRefusal({ type: 'image/png', size: 1024 * 1024 + 1 })).toEqual({ key: 'prof_photo_size', kib: 1025, max: 1024 });
    expect(avatarRefusal({ type: 'image/webp', size: 1024 })).toBeNull();
  });

  it('encodes bytes to base64', () => {
    expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  });

  it('reads an unknown confidence as a guess, and an unknown kind as written', () => {
    expect(aliasConfidence('confirmed')).toBe('confirmed');
    expect(aliasConfidence('whatever')).toBe('suggested');
    expect(aliasKindLabel('github', t)).toBe('prof_kind_github');
    expect(aliasKindLabel('jira', t)).toBe('jira');
    expect(loginProvider('keycloak', t)).toBe('prof_login_studio');
    expect(loginProvider('github', t)).toBe('github');
  });

  it('sums up a confirmation pass', () => {
    expect(
      confirmSummary({ confirmed: [], already_confirmed: 2, skipped_shared: 0, refused: ['Not yours.'] }, t)
    ).toBe('prof_nothing_to_confirm prof_already_confirmed(count=2) Not yours.');
    expect(
      confirmSummary({ confirmed: [{ kind: 'github', external_id: 'ann' }], already_confirmed: 0, skipped_shared: 1, refused: [] }, t)
    ).toBe('prof_confirmed(list=prof_kind_github ann) prof_skipped_shared(count=1)');
  });
});

describe('system', () => {
  it('counts a raw list whichever key wraps it', () => {
    expect(countOf([1, 2])).toBe(2);
    expect(countOf({ gears: [1] })).toBe(1);
    expect(countOf({ entities: [1, 2, 3] })).toBe(3);
    expect(countOf({ x: 1 })).toBeNull();
    expect(countOf(null)).toBeNull();
  });

  it('takes the gears that have a name', () => {
    expect(gearsOf({ gears: [{ name: 'a' }, { nope: 1 }, null] }).map((g) => g.name)).toEqual(['a']);
    expect(gearsOf([{ name: 'b' }]).map((g) => g.name)).toEqual(['b']);
  });

  it('reads the registered permissions by id pattern, once each and sorted', () => {
    const entities = {
      entities: [
        { gts_id: 'gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1' },
        { content: { refs: ['gts.cf.toolkit.authz.permission.v1~cf.studio.access.manage.v1'] } },
        { gts_id: 'gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1' },
      ],
    };
    expect(permissionsIn(entities)).toEqual([
      'gts.cf.toolkit.authz.permission.v1~cf.studio.access.manage.v1',
      'gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1',
    ]);
    expect(permissionsIn({ error: 'gts.cf.toolkit.authz.permission.v1~x.v1' })).toEqual([]);
    expect(permissionParts('gts.cf.toolkit.authz.permission.v1~cf.studio.people.view.v1')).toEqual({
      name: 'cf.studio.people.view',
      version: 'v1',
    });
  });

  it('tells a failed read from an answer', () => {
    expect(isReadFailure({ error: 'down' })).toBe(true);
    expect(isReadFailure({ items: [] })).toBe(false);
  });

  it('rows the entities: types end in ~', () => {
    const rows = entityRows({
      entities: [
        { gts_id: 'b.v1~x.v1', content: { title: 'X', description: 'An x' } },
        { gts_id: 'a.v1~' },
        { content: {} },
      ],
    });
    expect(rows).toEqual([
      { id: 'a.v1~', kind: 'type', title: '', description: '' },
      { id: 'b.v1~x.v1', kind: 'instance', title: 'X', description: 'An x' },
    ]);
  });

  it('knows which connections carry a message, and what a webhook or Zulip asks', () => {
    expect(isNotificationProvider('slack_webhook')).toBe(true);
    expect(isNotificationProvider('github')).toBe(false);
    expect(fixedTarget('discord_webhook', undefined)).toBe(true);
    expect(fixedTarget('discord_webhook', false)).toBe(false);
    expect(asksTopic('zulip', undefined)).toBe(true);
    expect(asksTopic('slack', undefined)).toBe(false);
  });

  it('sends a message trimmed, without empty fields', () => {
    expect(messageBody({ title: ' ', text: ' hi ', link: '', topic: 't' })).toEqual({
      title: undefined,
      text: 'hi',
      link: undefined,
      topic: 't',
    });
  });
});

describe('personal connections', () => {
  const row = (id: string, scope: string) => ({ id, scope }) as StoredConnection;
  it('splits the person own from the shared ones', () => {
    const rows = [row('a', 'personal'), row('b', 'organization'), row('c', 'workspace')];
    expect(personalConnections(rows).map((c) => c.id)).toEqual(['a']);
    expect(sharedConnections(rows).map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('never offers a person what only the organization holds', () => {
    const offered = personalProviders([
      { provider: 'github', category: 'source_code' },
      { provider: 'kubernetes', category: 'cluster' },
      { provider: 'registry', category: 'registry' },
      { provider: 'anthropic', category: 'ai' },
    ]);
    expect(offered.map((p) => p.provider)).toEqual(['github', 'anthropic']);
  });
});
