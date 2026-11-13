import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useNotify: () => notify,
}));
vi.mock('../../../../i18n', () => {
  const t = (key: string, params?: Record<string, string>) =>
    params ? `${key} ${JSON.stringify(params)}` : key;
  return { useSpecsText: () => t };
});

import { eventBus } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { useTypeDecisionRefusals } from './useTypeDecisionRefusals';

const refuse = (projectId: string, refusal: Refusal) =>
  eventBus.emit('mfe/projects/type-decision-refused', { projectId, name: 'prd.md', refusal });

beforeEach(() => notify.mockClear());

describe('a refused type decision', () => {
  it("becomes the shell's error toast, with the gear's reason", () => {
    renderHook(() => useTypeDecisionRefusals('p-1'));
    refuse('p-1', { kind: 'provider', text: 'unknown type' });
    expect(notify).toHaveBeenCalledWith({
      kind: 'error',
      text: 'type_refused_because {"name":"prd.md","reason":"unknown type"}',
    });
  });

  it('uses its own words when the gear gave none', () => {
    renderHook(() => useTypeDecisionRefusals('p-1'));
    refuse('p-1', { kind: 'i18n', key: 'type_refused' });
    expect(notify.mock.calls[0][0]).toEqual({
      kind: 'error',
      text: 'type_refused {"name":"prd.md"}',
    });
  });

  it("is not shown for another project's list", () => {
    renderHook(() => useTypeDecisionRefusals('p-1'));
    refuse('p-2', { kind: 'i18n', key: 'type_refused' });
    expect(notify).not.toHaveBeenCalled();
  });
});
