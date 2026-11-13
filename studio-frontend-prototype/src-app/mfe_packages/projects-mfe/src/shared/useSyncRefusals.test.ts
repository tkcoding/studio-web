import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useNotify: () => notify,
}));
vi.mock('../i18n', () => {
  const t = (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key;
  return { useSourcesText: () => t };
});

import { eventBus } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { useSyncRefusals } from './useSyncRefusals';

const refuse = (
  event: 'mfe/artifacts/cancel-refused' | 'mfe/artifacts/retry-refused',
  projectId: string,
  refusal: Refusal
) => eventBus.emit(event, { projectId, repo: 'acme/api', refusal });

beforeEach(() => notify.mockClear());

describe('a refused cancel or retry', () => {
  it.each([
    [
      'mfe/artifacts/cancel-refused',
      "with the gear's reason",
      { kind: 'provider', text: 'run is gone' },
      'sync_cancel_refused_because {"path":"acme/api","reason":"run is gone"}',
    ],
    [
      'mfe/artifacts/cancel-refused',
      'without a reason',
      { kind: 'i18n', key: 'artifacts_reason_cancel_refused' },
      'sync_cancel_refused {"path":"acme/api"}',
    ],
    [
      'mfe/artifacts/retry-refused',
      "with the gear's reason",
      { kind: 'provider', text: 'run is gone' },
      'sync_retry_refused_because {"path":"acme/api","reason":"run is gone"}',
    ],
    [
      'mfe/artifacts/retry-refused',
      'without a reason',
      { kind: 'i18n', key: 'artifacts_reason_retry_refused' },
      'sync_retry_refused {"path":"acme/api"}',
    ],
  ] as const)("%s %s becomes the shell's error toast", (event, _reason, refusal, text) => {
    renderHook(() => useSyncRefusals('p-1'));
    refuse(event, 'p-1', refusal);
    expect(notify).toHaveBeenCalledWith({ kind: 'error', text });
  });

  it("is not shown for another project's sources", () => {
    renderHook(() => useSyncRefusals('p-1'));
    refuse('mfe/artifacts/cancel-refused', 'p-2', { kind: 'provider', text: 'no' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops listening when the section goes', () => {
    const { unmount } = renderHook(() => useSyncRefusals('p-1'));
    unmount();
    refuse('mfe/artifacts/cancel-refused', 'p-1', { kind: 'provider', text: 'no' });
    refuse('mfe/artifacts/retry-refused', 'p-1', { kind: 'provider', text: 'no' });
    expect(notify).not.toHaveBeenCalled();
  });
});
