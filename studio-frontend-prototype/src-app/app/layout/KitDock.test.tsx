import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const { state, settle, chain } = vi.hoisted(() => ({
  state: {
    bootstrap: 'ready' as 'pending' | 'ready',
    editorShown: false,
    installed: null as ReadonlySet<string> | null,
    extensions: [] as { id: string; domain: string; entry: string; presentation?: { label: string; kit?: string; order?: number } }[],
  },
  settle: vi.fn(async () => undefined),
  chain: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: { executeActionsChain: chain } }),
  useAppSelector: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      'app/mfe-bootstrap': { status: state.bootstrap },
      'app/editor-session': { shown: state.editorShown },
    }),
  useDomainExtensions: () => state.extensions,
  ExtensionDomainSlot: () => <div data-testid="sidebar-slot" />,
}));
vi.mock('@/app/mfe/shellOutcomes', () => ({ executeAndSettle: settle }));
vi.mock('./useInstalledKits', () => ({ useInstalledKits: () => state.installed }));

import { KitDock, dockedExtension } from './KitDock';
import { MFE_BOOTSTRAP_SLICE_KEY } from '@/app/slices/mfeBootstrapSlice';
import { EDITOR_SESSION_SLICE_KEY } from '@/app/slices/editorSessionSlice';

const assistant = { id: 'ext.assistant', domain: 'sidebar', entry: 'e.a', presentation: { label: 'Studio AI', kit: 'assistant', order: 10 } };
const other = { id: 'ext.other', domain: 'sidebar', entry: 'e.o', presentation: { label: 'Other', kit: 'other', order: 5 } };
const shellOwn = { id: 'ext.shell', domain: 'sidebar', entry: 'e.s', presentation: { label: 'Nobody', order: 1 } };

describe('dockedExtension', () => {
  it('docks nothing while the installed kits are unknown', () => {
    expect(dockedExtension([assistant], null)).toBeNull();
  });

  it('docks nothing for a kit that is not installed here', () => {
    expect(dockedExtension([assistant], new Set(['project-tests']))).toBeNull();
  });

  it('docks the panel of an installed kit', () => {
    expect(dockedExtension([assistant], new Set(['assistant']))?.id).toBe('ext.assistant');
  });

  it('never docks an extension that names no kit', () => {
    expect(dockedExtension([shellOwn], new Set(['assistant']))).toBeNull();
  });

  it('of two installed kits, docks the lower order', () => {
    expect(dockedExtension([assistant, other], new Set(['assistant', 'other']))?.id).toBe('ext.other');
  });
});

describe('KitDock', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    state.installed = null;
    state.editorShown = false;
    state.bootstrap = 'ready';
    state.extensions = [];
  });

  it('the slice keys it reads are the shell’s', () => {
    expect(MFE_BOOTSTRAP_SLICE_KEY).toBe('app/mfe-bootstrap');
    expect(EDITOR_SESSION_SLICE_KEY).toBe('app/editor-session');
  });

  it('mounts the assistant’s panel where the kit is installed, and shows the slot', async () => {
    state.extensions = [assistant];
    state.installed = new Set(['assistant']);
    const { container } = render(<KitDock />);
    await waitFor(() =>
      expect(settle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ payload: { subject: 'ext.assistant' } })
      )
    );
    const dock = container.querySelector('aside')!;
    expect(dock.getAttribute('data-kit-dock')).toBe('assistant');
    expect(dock.className).not.toContain('hidden');
  });

  it('mounts nothing and shows nothing where the kit is not installed', () => {
    state.extensions = [assistant];
    state.installed = new Set(['project-tests']);
    const { container } = render(<KitDock />);
    expect(settle).not.toHaveBeenCalled();
    expect(container.querySelector('aside')!.className).toContain('hidden');
  });

  it('takes the panel away when the kit is uninstalled', async () => {
    state.extensions = [assistant];
    state.installed = new Set(['assistant']);
    const { rerender } = render(<KitDock />);
    await waitFor(() => expect(settle).toHaveBeenCalled());
    state.installed = new Set();
    rerender(<KitDock />);
    await waitFor(() =>
      expect(chain).toHaveBeenCalledWith({
        action: expect.objectContaining({ payload: { subject: 'ext.assistant' } }),
      })
    );
  });

  it('hides the docked panel over the editor, without unmounting it', async () => {
    state.extensions = [assistant];
    state.installed = new Set(['assistant']);
    state.editorShown = true;
    const { container } = render(<KitDock />);
    await waitFor(() => expect(settle).toHaveBeenCalled());
    expect(container.querySelector('aside')!.className).toContain('hidden');
    expect(chain).not.toHaveBeenCalled();
  });
});
