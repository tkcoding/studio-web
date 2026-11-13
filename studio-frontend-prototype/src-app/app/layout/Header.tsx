/** Header Component — the global top bar. */

import React, { useCallback, useState } from 'react';
import {
  useFrontX,
  useDomainExtensions,
  overlayDomain,
  FRONTX_ACTION_MOUNT_EXT,
} from '@gears-frontx/react';
import { executeAndSettle } from '@/app/mfe/shellOutcomes';
import { Button } from '@gears-frontx/ui-kit/button';
import { Icon } from '@iconify/react';
import { cn } from '@/app/lib/utils';
import type { OverlayExtension } from './overlayExtension';
import { ContextChain } from './ContextChain';
import { ProjectStatusSlot } from './KitSlot';
import { UserMenu } from './UserMenu';
import { ProductMenu } from './ProductMenu';
import { PinsMenu } from './PinsMenu';
import { WorkInbox } from './WorkInbox';
import { useInboxEntry } from './useInboxEntry';
import { useShellText } from '@/app/i18n/shellTranslations';

export interface HeaderProps {
  children?: React.ReactNode;
}

const IconPill: React.FC<{
  icon: string;
  label: string;
  unread?: boolean;
  /** A number on the pill: how many wait. */
  count?: number | null;
  /** The tooltip, when it says more than the label. */
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
}> = ({ icon, label, unread = false, count = null, title, disabled = false, onClick }) => (
  <span className="relative inline-flex">
    <Button
      variant="ghost"
      aria-label={label}
      title={title ?? label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      icon={<Icon icon={icon} />}
      className={cn(
        'rounded-full [--button-bg:var(--muted)] [--icon-size-sm:1.125rem]',
        disabled
          ? 'cursor-default [--button-fg:color-mix(in_oklab,var(--muted-foreground)_55%,transparent)]'
          : 'hover:[--button-fg:var(--foreground)]'
      )}
    />
    {!!count && count > 0 && (
      <span
        data-inbox-count
        className="pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] font-semibold leading-4 text-primary-foreground"
      >
        {count}
      </span>
    )}
    {unread && (
      <span className="pointer-events-none absolute right-0.5 top-px grid size-2 place-items-center">
        <span className="size-1.5 rounded-full bg-primary ring-1 ring-muted/50" />
      </span>
    )}
  </span>
);

export const Header: React.FC<HeaderProps> = ({ children }) => {
  const { mfeRegistry } = useFrontX();

  const overlayExtensions = useDomainExtensions(overlayDomain.id) as OverlayExtension[];
  const searchExtension = overlayExtensions.find((ext) => ext.presentation?.route === '/search');
  // The Inbox is a screen (organization-mfe, `/inbox`), opened from here with
  // how many items wait on the person (the prototype's InboxButton).
  const inbox = useInboxEntry();
  const t = useShellText();

  const [mounting, setMounting] = useState(false);

  const openOverlayExtension = useCallback(
    async (extensionId: string) => {
      if (!mfeRegistry || mounting) return;
      setMounting(true);
      try {
        await executeAndSettle(mfeRegistry, {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: overlayDomain.id,
          payload: { subject: extensionId },
        }).catch(() => undefined);
      } finally {
        setMounting(false);
      }
    },
    [mfeRegistry, mounting]
  );

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-card pr-4">
      <img
        src="/brand/constructor-weave.svg"
        alt=""
        width={32}
        height={32}
        className="ml-2 size-8 shrink-0"
      />

      {/* The product family: Studio, what kits add (Docs & API, ...), Admin. */}
      <ProductMenu />

      <div className="ml-8 flex min-w-0 items-center">
        <ContextChain />
        {/* A kit's status chip for the open project (slot project.header.status). */}
        <ProjectStatusSlot />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <IconPill
          icon={searchExtension?.presentation?.icon ?? 'material-symbols:search'}
          label={searchExtension?.presentation?.label ?? 'Search'}
          disabled={!searchExtension}
          onClick={
            searchExtension ? () => void openOverlayExtension(searchExtension.id) : undefined
          }
        />
        {/* The count is the server's (GET /me/inbox): nothing shows while it is unknown. */}
        <IconPill
          icon={inbox.screen?.presentation?.icon ?? 'material-symbols:inbox'}
          label={t('inbox')}
          title={inbox.count ? t('inbox_waiting', { count: inbox.count }) : t('inbox')}
          count={inbox.count}
          disabled={!inbox.screen}
          onClick={inbox.screen ? inbox.open : undefined}
        />
        {/* What the person keeps within one click (the prototype's rail pins). */}
        <PinsMenu />
        {/* What finished since the portal was opened (the prototype's bell). */}
        <WorkInbox />
        <UserMenu />
      </div>

      {children}
    </header>
  );
};

Header.displayName = 'Header';
