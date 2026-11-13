/** ContextChain Component — the path to the level in scope. */

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-chain:p1
// @cpt-dod:cpt-studiofrontend-dod-shell-levels-workspace-level:p1
import React, { useCallback, useRef, useState } from 'react';
import { useAppSelector, useDomainExtensions, eventBus, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbSeparator,
} from '@gears-frontx/ui-kit/breadcrumb';
import { Button } from '@gears-frontx/ui-kit/button';
import { Command, CommandEmpty, CommandItem, CommandList } from '@gears-frontx/ui-kit/command';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@gears-frontx/ui-kit/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@gears-frontx/ui-kit/popover';
import { Skeleton } from '@gears-frontx/ui-kit/skeleton';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Folder,
  Layers,
  Search,
  Server,
  type LucideIcon,
} from 'lucide-react';
import {
  APP_CONTEXT_SLICE_KEY,
  type AppContextState,
  type ContextEntity,
} from '@/app/slices/appContextSlice';
import { resolveLevelMenu, type ScreenLevel, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { useShellText } from '@/app/i18n/shellTranslations';
import type { ScreenText } from '@constructor-studio/mfe-shared';
import { useScreenLevel } from './useScreenLevel';
import { useOrgLogo } from './orgLogo';
import styles from './ContextChain.module.css';

interface ChainSlot {
  level: 'platform' | 'organization' | 'workspace' | 'project';
  caps: string;
  /** The entity in scope; `null` names none — the workspace slot at the organization level. */
  current: ContextEntity | null;
  /** What the trigger reads when `current` is `null`. */
  none?: string;
  options: ContextEntity[];
  Icon: LucideIcon;
  /** The entry for the level above, at the top of the menu. */
  up?: { label: string; level: ScreenLevel };
  pick: (id: string) => void;
  /** A level with one item (the platform): a button to it, no menu. */
  only?: boolean;
}

const pickWorkspace = (id: string) =>
  eventBus.emit('app/context/workspace/changed', { workspaceId: id });
const enterWorkspace = (id: string) =>
  eventBus.emit('app/context/workspace/changed', { workspaceId: id, enter: true });
const pickProject = (id: string) =>
  eventBus.emit('app/context/project/changed', { projectId: id });

// @cpt-begin:cpt-studiofrontend-algo-shell-levels-path:p1:inst-1
// @cpt-begin:cpt-studiofrontend-algo-shell-levels-path:p1:inst-2
const pickOrg = (id: string) => eventBus.emit('app/context/org/changed', { orgId: id });

/**
 * The whole path, the prototype's way (ADR-0069): the platform, then the
 * organization, then the workspace and the project as deep as the level goes.
 * Each segment names its level above its name and is the way to move along
 * it; the level header that used to repeat the name is gone.
 */
function slotsOf(
  level: ScreenLevel,
  context: AppContextState | undefined,
  t: ScreenText,
  hasPlatform: boolean
): ChainSlot[] {
  const head: ChainSlot[] = [];
  if (hasPlatform) {
    head.push({
      level: 'platform',
      caps: '',
      current: { id: 'platform', name: t('level_platform') },
      options: [],
      Icon: Server,
      pick: () => requestLevel('platform'),
      only: true,
    });
  }
  if (!context?.org) return head;
  head.push({
    level: 'organization',
    caps: t('chain_organization'),
    current: context.org,
    options: context.orgs ?? [],
    Icon: Building2,
    up: { label: t('chain_organization_overview', { organization: context.org.name }), level: 'organization' },
    pick: (id) => {
      if (id !== context.org?.id) pickOrg(id);
    },
  });
  // The platform and Admin sit beside the organizations: no workspace to pick.
  if (level === 'platform' || level === 'admin') return head;
  return [...head, ...belowOrganization(level, context, t)];
}

function belowOrganization(level: ScreenLevel, context: AppContextState, t: ScreenText): ChainSlot[] {
  const workspaces = context.workspaces ?? [];

  // @cpt-begin:cpt-studiofrontend-algo-shell-levels-path:p1:inst-4
  if (level === 'organization') {
    const pending = workspaces.length === 0 && context.workspacesStatus === 'pending';
    if (workspaces.length === 0 && !pending) return [];
    return [
      {
        level: 'workspace',
        caps: t('chain_workspace'),
        current: null,
        none: pending ? '' : t('chain_all_workspaces'),
        options: workspaces,
        Icon: Layers,
        pick: enterWorkspace,
      },
    ];
  }
  // @cpt-end:cpt-studiofrontend-algo-shell-levels-path:p1:inst-4

  if (!context.workspace) return [];
  const slots: ChainSlot[] = [
    {
      level: 'workspace',
      caps: t('chain_workspace'),
      current: context.workspace,
      options: workspaces,
      Icon: Layers,
      up: { label: t('chain_all_workspaces'), level: 'organization' },
      pick: pickWorkspace,
    },
  ];

  if (level === 'project' && context.project) {
    slots.push({
      level: 'project',
      caps: t('chain_project'),
      current: context.project,
      options: context.projects ?? [],
      Icon: Folder,
      up: {
        label: t('chain_projects_in', { workspace: context.workspace.name }),
        level: 'workspace',
      },
      pick: pickProject,
    });
  }

  return slots;
}
// @cpt-end:cpt-studiofrontend-algo-shell-levels-path:p1:inst-2
// @cpt-end:cpt-studiofrontend-algo-shell-levels-path:p1:inst-1

const requestLevel = (level: ScreenLevel) =>
  eventBus.emit('app/context/level/requested', { level });

/**
 * A slot's or an option's mark: the organization's logo where it has one (the
 * prototype's `OrgMark`), else the level's glyph.
 */
const SlotMark: React.FC<{ slot: ChainSlot; id: string | undefined; className?: string }> = ({ slot, id, className }) => {
  const logo = useOrgLogo(slot.level === 'organization' ? id : null);
  if (logo) {
    return <img src={logo} alt="" aria-hidden="true" className={className ?? 'size-4 rounded-sm object-contain'} data-org-logo={id} />;
  }
  return <slot.Icon strokeWidth={1.5} aria-hidden="true" />;
};

/** The slot's face: the design's ghost button — icon, name, chevron. */
const SlotFace = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { chainSlot: ChainSlot; isCurrent: boolean }
>(({ chainSlot: slot, isCurrent, ...props }, ref) => {
  const name = slot.current ? slot.current.name : slot.none;
  const label = slot.caps ? `${slot.caps}: ${name || '…'}` : name || '…';
  return (
    <Button
      ref={ref}
      variant="utility"
      size="sm"
      icon={<SlotMark slot={slot} id={slot.current?.id} />}
      aria-current={isCurrent ? 'page' : undefined}
      aria-label={label}
      className={styles.slot}
      {...props}
    >
      <span className={styles.face}>
        <span className={styles.text}>
          {slot.caps && <span className={styles.caps}>{slot.caps}</span>}
          {name ? (
            <span className={styles.name}>{name}</span>
          ) : (
            // An address can name a project before its tenant has been read
            // (ADR-0028): the id is published to the MFE at once, the name follows.
            <Skeleton className="h-4 w-24" data-testid="context-slot-pending" />
          )}
        </span>
        {!slot.only && <ChevronDown className={styles.chevron} strokeWidth={1.5} aria-hidden="true" />}
      </span>
    </Button>
  );
});
SlotFace.displayName = 'SlotFace';

const MenuSlot: React.FC<{ slot: ChainSlot; isCurrent: boolean }> = ({ slot, isCurrent }) => {
  const onPick = useCallback(
    (id: string) => {
      slot.pick(id);
      // Switching the organization moves the address itself (org/changed).
      if (!isCurrent && slot.current && slot.level !== 'organization') requestLevel(slot.level);
    },
    [slot, isCurrent]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={slot.options.length === 0 && !slot.up}
        render={<SlotFace chainSlot={slot} isCurrent={isCurrent} />}
      />
      <DropdownMenuContent align="start" className="!w-auto">
        {slot.up && (
          <>
            <DropdownMenuItem onClick={() => requestLevel(slot.up!.level)}>
              <slot.Icon aria-hidden="true" />
              {slot.up.label}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuRadioGroup value={slot.current?.id ?? ''} onValueChange={onPick}>
          {slot.options.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              closeOnClick
              // The radio group reports no change for the item already picked,
              // so from another level (the platform, Admin) picking it would
              // move nothing: it goes to that level here.
              onClick={
                !isCurrent && option.id === slot.current?.id ? () => requestLevel(slot.level) : undefined
              }
            >
              <SlotMark slot={slot} id={option.id} />
              {option.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The project slot. */
const SearchSlot: React.FC<{ slot: ChainSlot; isCurrent: boolean }> = ({ slot, isCurrent }) => {
  const t = useShellText();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  }, []);

  const choose = useCallback(
    (action: () => void) => {
      toggle(false);
      action();
    },
    [toggle]
  );

  const needle = query.trim().toLowerCase();
  const found = needle
    ? slot.options.filter((option) => option.name.toLowerCase().includes(needle))
    : slot.options;

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger render={<SlotFace chainSlot={slot} isCurrent={isCurrent} />} />
      <PopoverContent align="start" initialFocus={searchRef}>
        {slot.up && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Layers />}
            className="!justify-start"
            onClick={() => choose(() => requestLevel(slot.up!.level))}
          >
            {slot.up.label}
          </Button>
        )}
        <Command shouldFilter={false}>
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              type="search"
              placeholder={t('chain_search_projects')}
              aria-label={t('chain_search_projects')}
              value={query}
              onValueChange={setQuery}
            />
          </InputGroup>
          <CommandList>
            <CommandEmpty>{t('chain_no_projects')}</CommandEmpty>
            {found.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                onSelect={() =>
                  choose(() => {
                    if (option.id !== slot.current?.id) slot.pick(option.id);
                  })
                }
              >
                <slot.Icon aria-hidden="true" />
                {option.name}
                {option.id === slot.current?.id && <Check className="ml-auto" aria-hidden="true" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export const ContextChain: React.FC = () => {
  const t = useShellText();
  const context = useAppSelector(
    (state) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined
  );
  const level = useScreenLevel();
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const hasPlatform = resolveLevelMenu(screens, 'platform').length > 0;

  const slots = slotsOf(level, context, t, hasPlatform);
  if (slots.length === 0) {
    return context?.loading ? <Skeleton className="h-8 w-40" /> : null;
  }

  return (
    <Breadcrumb>
      {/* @cpt-begin:cpt-studiofrontend-algo-shell-levels-path:p1:inst-3 */}
      <BreadcrumbList className={styles.list}>
        {slots.map((slot, index) => (
          <React.Fragment key={slot.level}>
            {index > 0 && (
              <BreadcrumbSeparator className={styles.separator}>
                <ArrowRight strokeWidth={1.5} />
              </BreadcrumbSeparator>
            )}
            <BreadcrumbItem>
              {slot.only ? (
                <SlotFace chainSlot={slot} isCurrent={slot.level === level} onClick={() => slot.pick('')} />
              ) : slot.level === 'project' ? (
                <SearchSlot slot={slot} isCurrent={slot.level === level} />
              ) : (
                <MenuSlot slot={slot} isCurrent={slot.level === level} />
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
      {/* @cpt-end:cpt-studiofrontend-algo-shell-levels-path:p1:inst-3 */}
    </Breadcrumb>
  );
};

ContextChain.displayName = 'ContextChain';
