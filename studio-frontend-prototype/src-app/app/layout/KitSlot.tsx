/**
 * One named slot, drawn where the shell puts it (`mfe/slots.ts`): the slot
 * domain's root, the contributions that show here in their order, and a small
 * note for each one that did not come up. Nothing at all when nothing shows.
 */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ExtensionDomainSlot, useAppSelector, useDomainExtensions, useFrontX, type MfeRegistry } from '@gears-frontx/react';
import { MFE_BOOTSTRAP_SLICE_KEY, type MfeBootstrapState } from '@/app/slices/mfeBootstrapSlice';
import { runtimeKitsOf } from '@/app/mfe/runtimeKits';
import { SHELL_SLOTS, slotContributions, type ShellSlot, type SlotContribution } from '@/app/mfe/slots';
import { slotMountsOf } from '@/app/mfe/slotMounts';
import { useShellText } from '@/app/i18n/shellTranslations';
import { cn } from '@/app/lib/utils';
import { useInstalledKits } from './useInstalledKits';
import { useScreenLevel } from './useScreenLevel';
import { useScreenRoute } from './useScreenRoute';

export interface KitSlotProps {
  slot: ShellSlot;
  /** A row of chips or buttons, or a column of panels. */
  direction?: 'row' | 'column';
  className?: string;
}

function KitSlotIn({ slot, direction = 'row', className, registry }: KitSlotProps & { registry: MfeRegistry }) {
  const t = useShellText();
  const registered = useDomainExtensions(slot.domainId) as SlotContribution[];
  const installed = useInstalledKits();
  const level = useScreenLevel();
  const screenRoute = useScreenRoute();
  const kits = runtimeKitsOf(registry);
  // An upgrade keeps a contribution's id: the revision is what says it is another one.
  const subscribeKits = useCallback((listener: () => void) => kits.subscribe(listener), [kits]);
  const revision = useSyncExternalStore(subscribeKits, () => kits.revision(), () => kits.revision());
  const mounts = slotMountsOf(registry, slot.domainId);
  const failures = useSyncExternalStore(mounts.subscribe, mounts.failures, mounts.failures);
  const [attached, setAttached] = useState(false);

  const wanted = slotContributions(registered, { level, screenRoute, installed });
  const wantedKey = wanted.map((extension) => extension.id).join('\n');

  useEffect(() => {
    if (attached) mounts.reconcile(wanted);
    // `wanted` is read through its ids and the registry revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, mounts, wantedKey, revision]);

  const shownFailures = failures.filter((failure) => wanted.some((extension) => extension.id === failure.id));
  const column = direction === 'column';

  return (
    <div
      className={cn(
        'flex min-w-0',
        column ? 'flex-col items-stretch gap-3' : 'items-center gap-2',
        wanted.length === 0 && 'hidden',
        className
      )}
      data-kit-slot={slot.name}
    >
      <ExtensionDomainSlot
        registry={registry}
        domainId={slot.domainId}
        className={cn('flex min-w-0 empty:hidden', column ? 'flex-col gap-3' : 'items-center gap-2')}
        onAttached={() => setAttached(true)}
        onDetached={() => setAttached(false)}
      />
      {shownFailures.map((failure) => (
        <span
          key={failure.id}
          role="status"
          title={failure.reason}
          data-kit-slot-failed={failure.id}
          className="inline-flex items-center gap-1 self-start rounded-md border border-destructive/40 px-2 py-0.5 text-label text-muted-foreground"
        >
          <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
          {t('kit_slot_failed', { label: failure.label })}
        </span>
      ))}
    </div>
  );
}

export const KitSlot: React.FC<KitSlotProps> = (props) => {
  const registry = useFrontX().mfeRegistry;
  // The slot domains are registered by `bootstrapMFE`; the header draws before
  // that, and attaching to a domain that is not there throws. The bootstrap
  // status is the store change that draws this again once it is.
  useAppSelector((state) => (state[MFE_BOOTSTRAP_SLICE_KEY] as MfeBootstrapState | undefined)?.status);
  if (!registry?.getDomain(props.slot.domainId)) return null;
  return <KitSlotIn {...props} registry={registry} />;
};

KitSlot.displayName = 'KitSlot';

/** `project.header.status`: beside the open project in the path bar, only while a project is open. */
export const ProjectStatusSlot: React.FC = () => {
  const level = useScreenLevel();
  return level === 'project' ? <KitSlot slot={SHELL_SLOTS.projectHeaderStatus} className="ml-3" /> : null;
};

ProjectStatusSlot.displayName = 'ProjectStatusSlot';
