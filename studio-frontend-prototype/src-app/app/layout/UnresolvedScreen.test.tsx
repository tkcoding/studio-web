import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MfeRegistry } from '@gears-frontx/react';

const { emit, known } = vi.hoisted(() => ({
  emit: vi.fn(),
  known: new Map<string, { kit: string; label: string }>(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: { emit, on: vi.fn() },
}));
vi.mock('@/app/mfe/runtimeKits', () => ({
  runtimeKitsOf: () => ({ knownScreen: (token: string) => known.get(token) }),
}));
vi.mock('@/app/i18n/shellTranslations', () => ({
  useShellText: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

import { unresolvedScreenOf } from '@/app/routing/unresolvedScreen';
import { UnresolvedScreen } from './UnresolvedScreen';

describe('UnresolvedScreen', () => {
  const registry = {} as MfeRegistry;
  const store = unresolvedScreenOf(registry);

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    known.clear();
    store.set(null);
  });

  it('draws nothing while the address has its screen', () => {
    const { container } = render(<UnresolvedScreen registry={registry} />);
    expect(container.innerHTML).toBe('');
  });

  it('says it is waiting for the kits, then that the screen is not available here', () => {
    render(<UnresolvedScreen registry={registry} />);
    act(() => store.set({ token: 'hello-kit', status: 'waiting', level: 'project' }));
    expect(screen.getByRole('status').textContent).toBe('screen_waiting_for_kits:hello-kit');
    act(() => store.set({ token: 'hello-kit', status: 'unknown', level: 'project' }));
    expect(screen.getByRole('alert').textContent).toContain('screen_unknown_body:hello-kit');
  });

  it('names the kit a screen came from once that kit is gone, and offers the level’s home', () => {
    known.set('hello-kit', { kit: 'hello-kit', label: 'Hello' });
    store.set({ token: 'hello-kit', status: 'unknown', level: 'project' });
    render(<UnresolvedScreen registry={registry} />);
    expect(screen.getByRole('alert').textContent).toContain('screen_unknown_kit:Hello,hello-kit');
    fireEvent.click(screen.getByRole('button', { name: 'screen_unknown_home' }));
    expect(emit).toHaveBeenCalledWith('app/context/level/requested', { level: 'project' });
  });
});
