import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import en from '../i18n/en.json';
import { MAX_SOURCES } from '../../../model/projectDraft';
import { CREATE_SLICE_KEY } from '../../../slices/createSlice';

const { picked } = vi.hoisted(() => ({ picked: { count: 0 } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ [CREATE_SLICE_KEY]: { draft: { sources: Array.from({ length: picked.count }) } } }),
}));

vi.mock('../../../i18n', async () => {
  const { dictionaryText } = await import('@frontx-test-utils/dictionaryText');
  return { useProjectCreateText: () => dictionaryText(en) };
});

import { RepositoriesFooterNote } from './RepositoriesFooterNote';

const noteFor = (count: number) => {
  picked.count = count;
  const { container } = render(<RepositoriesFooterNote />);
  return container.textContent;
};

describe('RepositoriesFooterNote', () => {
  afterEach(cleanup);

  it('says none is selected', () => {
    expect(noteFor(0)).toBe('None selected');
  });

  it('counts what is selected', () => {
    expect(noteFor(1)).toBe('1 selected');
    cleanup();
    expect(noteFor(2)).toBe('2 selected');
  });

  it('says when the maximum is reached', () => {
    expect(noteFor(MAX_SOURCES)).toBe(`${MAX_SOURCES} selected (maximum)`);
  });

  it('counts the last one below the maximum as any other', () => {
    expect(noteFor(MAX_SOURCES - 1)).toBe(`${MAX_SOURCES - 1} selected`);
  });
});
