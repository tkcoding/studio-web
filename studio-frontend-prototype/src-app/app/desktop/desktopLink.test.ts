import { describe, expect, it } from 'vitest';
import { desktopLink, desktopNames, myDesktop, type DesktopSession } from './desktopLink';

const desktop = (over: Partial<DesktopSession>): DesktopSession => ({
  id: 'd',
  workspace_id: 'p1',
  member_id: 'me',
  device_id: 'dev',
  device_name: 'ThinkPad',
  started_at_epoch_secs: 1,
  last_seen_epoch_secs: 1,
  expires_at_epoch_secs: 100,
  heartbeat_secs: 30,
  ...over,
});

describe('desktopLink', () => {
  it('names this Studio, its realm and the project, and carries no token', () => {
    const link = desktopLink(
      { id: 'p1', name: 'Web portal' },
      { origin: 'https://studio.example', issuer: 'https://id.example/realms/studio/' }
    );
    const url = new URL(link);
    expect(url.protocol).toBe('cfstudio:');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      studio: 'https://studio.example',
      issuer: 'https://id.example/realms/studio',
      project: 'p1',
      name: 'Web portal',
    });
    expect(link).not.toMatch(/token/i);
  });
});

describe('desktopNames', () => {
  const text = { unnamed: 'a desktop', you: (device: string) => `${device} (you)` };
  it('names each desktop, the member’s own marked, an unnamed one plainly', () => {
    expect(
      desktopNames([desktop({}), desktop({ member_id: 'other', device_name: '  ' })], 'me', text)
    ).toEqual(['ThinkPad (you)', 'a desktop']);
    expect(desktopNames([], 'me', text)).toEqual([]);
  });
});

describe('myDesktop', () => {
  it('picks the member’s desktop heard from last', () => {
    const sessions = [
      desktop({ id: 'old', last_seen_epoch_secs: 5 }),
      desktop({ id: 'new', last_seen_epoch_secs: 9 }),
      desktop({ id: 'theirs', member_id: 'other', last_seen_epoch_secs: 99 }),
    ];
    expect(myDesktop(sessions, 'me')?.id).toBe('new');
    expect(myDesktop(sessions, undefined)).toBeUndefined();
    expect(myDesktop([desktop({ member_id: 'other' })], 'me')).toBeUndefined();
  });
});
