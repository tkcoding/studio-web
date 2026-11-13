import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockEmit, store, desktops } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  store: { state: {} as Record<string, unknown> },
  desktops: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useAppSelector: (select: (root: Record<string, unknown>) => unknown) => select(store.state),
  eventBus: { on: vi.fn(), emit: mockEmit },
  apiRegistry: {
    has: () => true,
    getService: () => ({ sessions: (args: unknown) => ({ fetch: () => desktops(args) }) }),
  },
}));
vi.mock('@/app/i18n/shellTranslations', () => ({
  useShellText: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join('|')}` : key,
}));

import { EditorBar } from './EditorBar';

function inEditor(phase: 'launching' | 'ready' | 'failed' | 'idle' = 'ready', shown = true): void {
  store.state = {
    'app/editor-session': { phase, failure: null, shown },
    'app/context': { project: { id: 'p1', name: 'Web portal' } },
    'app/session': { profile: { id: 'me' } },
  };
}

describe('EditorBar', () => {
  beforeEach(() => {
    desktops.mockResolvedValue({ items: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    store.state = {};
  });

  it('draws nothing off the editor', () => {
    inEditor('ready', false);
    const { container } = render(<EditorBar />);
    expect(container.innerHTML).toBe('');
  });

  it('reloads the IDE through the session, without stopping it', () => {
    inEditor('ready');
    render(<EditorBar />);
    fireEvent.click(screen.getByText('editor_reload'));
    expect(mockEmit).toHaveBeenCalledWith('app/editor/session/reload');
  });

  it('stops only after it is confirmed', async () => {
    inEditor('ready');
    mockEmit.mockImplementation((name: string, payload?: { done?: () => void }) => {
      if (name === 'app/editor/session/stop') payload?.done?.();
    });
    render(<EditorBar />);
    fireEvent.click(screen.getByText('editor_stop'));
    expect(mockEmit).not.toHaveBeenCalledWith('app/editor/session/stop', expect.anything());
    expect(screen.getByText('editor_stop_confirm')).toBeTruthy();
    fireEvent.click(screen.getAllByText('editor_stop')[0]);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith('app/editor/session/stop', expect.anything()));
  });

  it('offers no Reload or Stop while there is no session', () => {
    inEditor('failed');
    render(<EditorBar />);
    expect((screen.getByText('editor_reload').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('editor_stop').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says which desktops the project is open on, the member’s own marked', async () => {
    inEditor('ready');
    desktops.mockResolvedValue({
      items: [
        { id: 'd1', member_id: 'me', device_name: 'ThinkPad', heartbeat_secs: 30 },
        { id: 'd2', member_id: 'other', device_name: 'Mac', heartbeat_secs: 30 },
      ],
      total: 2,
    });
    render(<EditorBar />);
    await waitFor(() =>
      expect(document.querySelector('[data-desktop-presence]')?.textContent).toBe(
        'editor_desktop_open_on:2|editor_desktop_you:ThinkPad, Mac'
      )
    );
    expect(desktops).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('hands the project to the desktop app, and says where to get it when nothing took the link', async () => {
    inEditor('ready');
    vi.useFakeTimers();
    const assign = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, assign, origin: 'https://studio.example' } });
    try {
      render(<EditorBar />);
      fireEvent.click(screen.getByText('editor_desktop'));
      const link = new URL(assign.mock.calls[0][0] as string);
      expect(link.protocol).toBe('cfstudio:');
      expect(link.searchParams.get('project')).toBe('p1');
      expect(link.searchParams.get('name')).toBe('Web portal');
      expect(link.searchParams.get('studio')).toBe('https://studio.example');
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(document.querySelector('[data-desktop-missing]')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
  });
});
