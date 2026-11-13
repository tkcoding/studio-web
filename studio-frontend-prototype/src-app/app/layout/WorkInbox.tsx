/**
 * The bell: what finished since you opened the portal (the prototype's
 * `WorkInbox`, `work-inbox.tsx`). The model is `app/live/completedWork.ts`;
 * the events are the shell's live channel.
 *
 * Opening the panel reads everything at once. "Background work" goes to the
 * screen that answers everything this panel deliberately does not.
 */

import React, { useCallback, useState } from 'react';
import { eventBus, useDomainExtensions, FRONTX_SCREEN_DOMAIN } from '@gears-frontx/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { Bell, Check, ListChecks, Minus, X } from 'lucide-react';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { useShellText } from '@/app/i18n/shellTranslations';
import { useStudioEvents } from '@/app/live/useLiveChannel';
import {
  NO_COMPLETED_WORK,
  addCompleted,
  ago,
  completedRunOf,
  markRead,
  taskLabel,
  type CompletedRun,
  type CompletedWork,
} from '@/app/live/completedWork';

/** The screen the panel hands over to: Organization › Background work. */
export const BACKGROUND_WORK_ROUTE = '/organization/tasks';

const STATE_ICON: Record<CompletedRun['state'], React.ReactNode> = {
  succeeded: <Check aria-hidden="true" className="size-4 text-success" />,
  failed: <X aria-hidden="true" className="size-4 text-destructive" />,
  cancelled: <Minus aria-hidden="true" className="size-4 text-muted-foreground" />,
};

export const WorkInbox: React.FC = () => {
  const t = useShellText();
  const [work, setWork] = useState<CompletedWork>(NO_COMPLETED_WORK);
  const [now, setNow] = useState(0);
  const screens = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const background = screens.find((screen) => screen.presentation?.route === BACKGROUND_WORK_ROUTE);

  useStudioEvents(
    useCallback((event) => {
      const run = completedRunOf(event);
      if (run) setWork((current) => addCompleted(current, run));
    }, [])
  );

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    setNow(Date.now());
    setWork(markRead);
  }, []);

  const when = (atMs: number): string => {
    const { unit, count } = ago(atMs, now);
    return unit === 'now' ? t('work_inbox_just_now') : t(`work_inbox_ago_${unit}`, { count });
  };

  const label = t('work_inbox');
  const title = work.unread > 0 ? t('work_inbox_unread', { count: work.unread }) : label;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={title}
            className="relative inline-flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Bell aria-hidden="true" className="size-[1.125rem]" />
        {work.unread > 0 && (
          <span
            data-work-inbox-count
            className="pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[0.625rem] font-semibold leading-4 text-primary-foreground"
          >
            {work.unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-80 rounded-lg" aria-label={label}>
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-body font-medium text-foreground">{label}</span>
        </div>
        <DropdownMenuSeparator />
        {work.runs.length === 0 ? (
          <div className="px-2 py-3" data-work-inbox-empty>
            <div className="text-body text-foreground">{t('work_inbox_empty')}</div>
            <div className="text-label text-muted-foreground">{t('work_inbox_empty_hint')}</div>
          </div>
        ) : (
          <ul className="max-h-80 overflow-y-auto" aria-label={label}>
            {work.runs.map((run) => (
              <li key={run.runId} data-work-inbox-run={run.state} className="flex items-start gap-2 px-2 py-1.5">
                <span className="mt-0.5" title={t(`work_inbox_state_${run.state}`)}>
                  {STATE_ICON[run.state]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body text-foreground">{taskLabel(run.taskType)}</span>
                  {run.line && <span className="line-clamp-2 text-label text-muted-foreground">{run.line}</span>}
                </span>
                <span className="shrink-0 text-label text-muted-foreground">{when(run.atMs)}</span>
              </li>
            ))}
          </ul>
        )}
        {background && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => eventBus.emit('app/context/screen/requested', { extensionId: background.id })}
            >
              <ListChecks aria-hidden="true" />
              {t('work_inbox_see_all')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

WorkInbox.displayName = 'WorkInbox';
