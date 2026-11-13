import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { SlotFailure } from '@/app/mfe/slotMounts';

const { state, reconcile, failures } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let list: SlotFailure[] = [];
  return {
    state: {
      registered: [] as Array<{ id: string; domain: string; entry: string; presentation: Record<string, unknown> }>,
      installed: null as ReadonlySet<string> | null,
      level: 'project' as string,
      screenRoute: '/projects/overview' as string | null,
      domains: true,
    },
    reconcile: vi.fn(),
    failures: {
      get: () => list,
      set(next: SlotFailure[]) {
        list = next;
        for (const l of listeners) l();
      },
      subscribe(l: () => void) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  };
});

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useFrontX: () => ({ mfeRegistry: { getDomain: (id: string) => (state.domains ? { id } : undefined) } }),
  useAppSelector: () => 'ready',
  useDomainExtensions: () => state.registered,
  ExtensionDomainSlot: ({ domainId, onAttached }: { domainId: string; onAttached?: (root: Element) => void }) => (
    <div data-domain-id={domainId} ref={(el) => { if (el) onAttached?.(el); }} />
  ),
}));
vi.mock('@/app/mfe/slotMounts', () => ({
  slotMountsOf: () => ({ reconcile, failures: failures.get, subscribe: failures.subscribe }),
}));
vi.mock('@/app/mfe/runtimeKits', () => ({
  runtimeKitsOf: () => ({ subscribe: () => () => undefined, revision: () => 0 }),
}));
vi.mock('./useInstalledKits', () => ({ useInstalledKits: () => state.installed }));
vi.mock('./useScreenLevel', () => ({ useScreenLevel: () => state.level }));
vi.mock('./useScreenRoute', () => ({ useScreenRoute: () => state.screenRoute }));
vi.mock('@/app/i18n/shellTranslations', () => ({
  useShellText: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}:${Object.values(params).join(',')}` : key,
}));

import { KitSlot, ProjectStatusSlot } from './KitSlot';
import { SHELL_SLOTS } from '@/app/mfe/slots';

const panel = (name: string, presentation: Record<string, unknown> = {}) => ({
  id: `ext.${name}`,
  domain: SHELL_SLOTS.screenPanels.domainId,
  entry: 'entry',
  presentation: { label: name, ...presentation },
});

describe('KitSlot', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    failures.set([]);
    state.registered = [];
    state.installed = null;
    state.level = 'project';
    state.screenRoute = '/projects/overview';
    state.domains = true;
  });

  it('draws nothing before the shell has registered its slot domains', () => {
    state.domains = false;
    const { container } = render(<KitSlot slot={SHELL_SLOTS.screenPanels} />);
    expect(container.innerHTML).toBe('');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('mounts, in order, the contributions that show here once its root is attached', () => {
    state.registered = [
      panel('later', { order: 20 }),
      panel('elsewhere', { screen: '/projects/artifacts' }),
      panel('first', { order: 10, kit: 'alpha' }),
    ];
    render(<KitSlot slot={SHELL_SLOTS.screenPanels} direction="column" />);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].map((ext: { id: string }) => ext.id)).toEqual(['ext.first', 'ext.later']);
  });

  it('leaves out a kit’s contribution where the kit is not installed, and draws nothing when nothing shows', () => {
    state.installed = new Set(['beta']);
    state.registered = [panel('alpha', { kit: 'alpha' })];
    const { container } = render(<KitSlot slot={SHELL_SLOTS.screenPanels} />);
    expect(reconcile.mock.calls[0][0]).toEqual([]);
    expect(container.querySelector('[data-kit-slot]')?.className).toContain('hidden');
  });

  it('names a contribution that did not come up, beside the others', () => {
    state.registered = [panel('broken'), panel('fine')];
    render(<KitSlot slot={SHELL_SLOTS.screenPanels} />);
    act(() => failures.set([{ id: 'ext.broken', label: 'broken', reason: 'chunk 404' }]));
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('kit_slot_failed:broken');
    expect(note.getAttribute('title')).toBe('chunk 404');
  });

  it('draws the project status slot only while a project is open', () => {
    state.level = 'workspace';
    const { container, rerender } = render(<ProjectStatusSlot />);
    expect(container.querySelector('[data-kit-slot]')).toBeNull();
    state.level = 'project';
    rerender(<ProjectStatusSlot />);
    expect(container.querySelector('[data-kit-slot="project.header.status"]')).not.toBeNull();
  });
});
