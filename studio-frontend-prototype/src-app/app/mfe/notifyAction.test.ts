import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@gears-frontx/ui-kit/toast', () => ({ toast }));

import notifySchema from './schemas/action_shell_notification_show.v1.json';
import { STUDIO_NOTICE_KINDS } from '@constructor-studio/mfe-shared';
import { createNotifyHandler, noticeOf, showNotice } from './notifyAction';

beforeEach(() => toast.add.mockClear());

describe('notify', () => {
  it('shows the text as a toast of its kind', async () => {
    const handler = createNotifyHandler();
    for (const kind of ['error', 'success', 'info'] as const) {
      await handler.handleAction('action', { kind, text: 'Not saved' });
      expect(toast.add).toHaveBeenLastCalledWith(expect.objectContaining({ type: kind, title: 'Not saved' }));
    }
  });

  it('gives the toast the id, so progress and its outcome are one toast', async () => {
    const handler = createNotifyHandler();
    await handler.handleAction('action', { kind: 'loading', text: 'Checking 3/20', id: 'check:p-1' });
    await handler.handleAction('action', { kind: 'success', text: '20 checked', id: 'check:p-1' });
    expect(toast.add.mock.calls.map(([options]) => [options.id, options.type])).toEqual([
      ['check:p-1', 'loading'],
      ['check:p-1', 'success'],
    ]);
  });

  it('closes success and info after 6 seconds and keeps error and loading', () => {
    showNotice({ kind: 'success', text: 'x' });
    showNotice({ kind: 'info', text: 'x' });
    showNotice({ kind: 'error', text: 'x' });
    showNotice({ kind: 'loading', text: 'x', id: 'check:p-1' });
    expect(toast.add.mock.calls.map(([options]) => options.timeout)).toEqual([6000, 6000, 0, 0]);
  });

  it('refuses a payload with an unknown kind, no text or an id that is not a name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(noticeOf({ kind: 'warning', text: 'x' })).toBeNull();
    expect(noticeOf({ kind: 'info', text: '' })).toBeNull();
    expect(noticeOf({ kind: 'info', text: 'x', id: '' })).toBeNull();
    expect(noticeOf({ kind: 'info', text: 'x', id: 7 })).toBeNull();
    // Nothing could ever close it.
    expect(noticeOf({ kind: 'loading', text: 'Checking' })).toBeNull();
    expect(noticeOf(undefined)).toBeNull();
    await createNotifyHandler().handleAction('action', { kind: 'warning', text: 'x' });
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('names the kinds mfe-shared declares', () => {
    expect(notifySchema.properties.payload.properties.kind.enum).toEqual([...STUDIO_NOTICE_KINDS]);
  });

  it('requires an id in the schema for exactly the kinds noticeOf refuses without one', () => {
    const payload = notifySchema.properties.payload;
    expect(payload.properties.id.minLength).toBe(1);
    expect(payload.then.required).toEqual(['id']);
    for (const kind of STUDIO_NOTICE_KINDS) {
      const needsId = payload.if.properties.kind.const === kind;
      expect(noticeOf({ kind, text: 'x' }) === null).toBe(needsId);
    }
  });
});
