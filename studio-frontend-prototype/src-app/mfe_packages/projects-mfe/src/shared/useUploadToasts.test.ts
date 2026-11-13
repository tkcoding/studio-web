import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useNotify: () => notify,
}));
vi.mock('../i18n', () => {
  const t = Object.assign((key: string) => key, {
    count: (key: string, count: number, params?: Record<string, unknown>) =>
      `${key}#${count}${params ? `(${Object.values(params).join('|')})` : ''}`,
  });
  return { useUploadText: () => t, useUploadTranslations: () => ({ isLoaded: true }) };
});

import { eventBus } from '@gears-frontx/react';
import { useUploadToasts } from './useUploadToasts';

const finish = (added: number, refused: number) =>
  eventBus.emit('mfe/projects/documents-upload-finished', {
    projectId: 'p-1',
    project: 'Billing',
    added,
    refused,
  });

beforeEach(() => notify.mockClear());

describe('a finished upload', () => {
  it('says what was added as a success toast and what was refused as an error toast', () => {
    renderHook(() => useUploadToasts());
    finish(3, 1);
    expect(notify.mock.calls).toEqual([
      [{ kind: 'success', text: 'toast_added#3(Billing)' }],
      [{ kind: 'error', text: 'toast_refused#1(Billing)' }],
    ]);
  });

  it('stops listening when the root goes', () => {
    const { unmount } = renderHook(() => useUploadToasts());
    unmount();
    finish(1, 1);
    expect(notify).not.toHaveBeenCalled();
  });
});
