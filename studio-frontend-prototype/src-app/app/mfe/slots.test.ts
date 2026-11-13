/**
 * The slot contract (issue #1006, `slots.ts`, `slotMounts.ts`): which
 * contributions show where and in what order, and that one contribution
 * failing touches no other.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FRONTX_ACTION_MOUNT_EXT, FRONTX_ACTION_UNMOUNT_EXT, type Action, type MfeRegistry } from '@gears-frontx/react';

const { execute, mountFailed } = vi.hoisted(() => ({ execute: vi.fn(), mountFailed: vi.fn() }));
vi.mock('./shellOutcomes', () => ({ executeAndSettle: (_registry: unknown, action: Action) => execute(action) }));
vi.mock('./runtimeKits', () => ({ runtimeKitsOf: () => ({ mountFailed }) }));

import { occupancyOf } from './domainOccupancy';
import { createSlotMounts } from './slotMounts';
import { SHELL_SLOTS, slotContributions, type SlotContribution } from './slots';

const DOMAIN = SHELL_SLOTS.screenPanels.domainId;

const contribution = (name: string, presentation: Partial<SlotContribution['presentation']> = {}): SlotContribution => ({
  id: `gts.frontx.mfes.ext.extension.v1~constructor_studio.shell.slots.contribution.v1~example.kit.slots.${name}.v1`,
  domain: DOMAIN,
  entry: 'entry',
  presentation: { label: name, ...presentation },
});

describe('slotContributions', () => {
  const place = { level: 'project' as const, screenRoute: '/projects/overview', installed: new Set(['alpha']) };

  it('orders by order, then id, undeclared last', () => {
    const shown = slotContributions(
      [contribution('c'), contribution('b', { order: 20 }), contribution('a', { order: 20 }), contribution('z', { order: 5 })],
      { ...place, installed: null }
    );
    expect(shown.map((ext) => ext.presentation?.label)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('shows a kit’s contribution only where the kit is installed, and everything while that is unknown', () => {
    const items = [contribution('mine', { kit: 'alpha' }), contribution('theirs', { kit: 'beta' }), contribution('shell')];
    expect(slotContributions(items, place).map((ext) => ext.presentation?.label)).toEqual(['mine', 'shell']);
    expect(slotContributions(items, { ...place, installed: null })).toHaveLength(3);
  });

  it('keeps a contribution to its level and its screen when it names them', () => {
    const items = [
      contribution('overview', { screen: '/projects/overview' }),
      contribution('artifacts', { screen: '/projects/artifacts' }),
      contribution('workspace', { level: 'workspace' }),
      contribution('anywhere'),
    ];
    expect(slotContributions(items, place).map((ext) => ext.presentation?.label)).toEqual(['anywhere', 'overview']);
  });
});

describe('createSlotMounts', () => {
  let registry: { getExtension: (id: string) => SlotContribution | undefined };
  let extensions: Map<string, SlotContribution>;
  let mounts: ReturnType<typeof createSlotMounts>;
  const occupancy = () => occupancyOf(registry as unknown as MfeRegistry);
  const mounted = () => [...occupancy().mounted(DOMAIN)];

  /** The runtime: a mount of `broken` fails, the rest land in the domain. */
  beforeEach(() => {
    extensions = new Map();
    registry = { getExtension: (id) => extensions.get(id) };
    mounts = createSlotMounts(registry as unknown as MfeRegistry, DOMAIN);
    execute.mockReset();
    mountFailed.mockReset();
    execute.mockImplementation(async (action: Action) => {
      const subject = (action.payload as { subject: string }).subject;
      if (action.type === FRONTX_ACTION_MOUNT_EXT) {
        if (subject.includes('broken')) throw new Error('chunk 404');
        occupancy().mountFinished(DOMAIN, subject);
      } else if (action.type === FRONTX_ACTION_UNMOUNT_EXT) {
        occupancy().destroyed(DOMAIN, subject);
      }
    });
  });

  const known = (...items: SlotContribution[]) => {
    for (const item of items) extensions.set(item.id, item);
    return items;
  };

  it('mounts each contribution on its own chain, and a failing one touches no other', async () => {
    const [a, broken, b] = known(contribution('a'), contribution('broken'), contribution('b'));
    mounts.reconcile([a, broken, b]);
    await vi.waitFor(() => expect(mounts.failures()).toHaveLength(1));
    expect(mounted().sort()).toEqual([a.id, b.id].sort());
    expect(mounts.failures()[0]).toEqual({ id: broken.id, label: 'broken', reason: 'chunk 404' });
    // A kit's contribution says so on the kit's tile too.
    expect(mountFailed).toHaveBeenCalledWith(broken.id, 'chunk 404');
  });

  it('does not try a failed contribution again while its registration is the same', async () => {
    const [broken] = known(contribution('broken'));
    mounts.reconcile([broken]);
    await vi.waitFor(() => expect(mounts.failures()).toHaveLength(1));
    mounts.reconcile([broken]);
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('tries again once the contribution is registered anew (an upgrade)', async () => {
    const [broken] = known(contribution('broken'));
    mounts.reconcile([broken]);
    await vi.waitFor(() => expect(mounts.failures()).toHaveLength(1));
    const upgraded = { ...broken };
    extensions.set(upgraded.id, upgraded);
    mounts.reconcile([upgraded]);
    expect(mounts.failures()).toEqual([]);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  });

  it('unmounts what is no longer wanted, and leaves the rest mounted', async () => {
    const [a, b] = known(contribution('a'), contribution('b'));
    mounts.reconcile([a, b]);
    await vi.waitFor(() => expect(mounted()).toHaveLength(2));
    mounts.reconcile([b]);
    await vi.waitFor(() => expect(mounted()).toEqual([b.id]));
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('asks nothing of a contribution its kit took away: the runtime released it', async () => {
    const [a] = known(contribution('a'));
    mounts.reconcile([a]);
    await vi.waitFor(() => expect(mounted()).toEqual([a.id]));
    extensions.delete(a.id);
    mounts.reconcile([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('mounts again a contribution the runtime released when it was upgraded', async () => {
    const [a] = known(contribution('a'));
    mounts.reconcile([a]);
    await vi.waitFor(() => expect(mounted()).toEqual([a.id]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Unregistration released it; the new revision is registered under the same id.
    occupancy().destroyed(DOMAIN, a.id);
    mounts.reconcile([a]);
    await vi.waitFor(() => expect(mounted()).toEqual([a.id]));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('takes out a contribution that finished mounting after it stopped being wanted', async () => {
    const [a] = known(contribution('a'));
    let land!: () => void;
    execute.mockImplementationOnce(
      (action: Action) =>
        new Promise<void>((resolve) => {
          land = () => {
            occupancy().mountFinished(DOMAIN, (action.payload as { subject: string }).subject);
            resolve();
          };
        })
    );
    mounts.reconcile([a]);
    mounts.reconcile([]);
    land();
    await vi.waitFor(() => expect(mounted()).toEqual([]));
  });
});
