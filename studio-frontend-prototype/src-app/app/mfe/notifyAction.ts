/** The MFE -> shell channel for toasts: the shell owns the only toaster. */

import { ActionHandler } from '@gears-frontx/react';
import { toast } from '@gears-frontx/ui-kit/toast';
import { STUDIO_NOTICE_KINDS, type StudioNotice } from '@constructor-studio/mfe-shared';

/** The prototype's timing: success and info close by themselves, error and loading stay. */
const TIMEOUT_MS: Record<StudioNotice['kind'], number> = { success: 6000, info: 6000, error: 0, loading: 0 };

/** The notify payload as the schema names it, or `null` when it is not one. */
export function noticeOf(payload: Record<string, unknown> | undefined): StudioNotice | null {
  const { kind, text, id } = payload ?? {};
  const known = STUDIO_NOTICE_KINDS.find((candidate) => candidate === kind);
  if (!known || typeof text !== 'string' || !text) return null;
  // A loading toast never closes by itself: only a notice with its id can end it.
  if (id === undefined) return known === 'loading' ? null : { kind: known, text };
  if (typeof id !== 'string' || !id) return null;
  return { kind: known, text, id };
}

export function showNotice(notice: StudioNotice): void {
  toast.add({ id: notice.id, type: notice.kind, title: notice.text, timeout: TIMEOUT_MS[notice.kind] });
}

export function createNotifyHandler(): ActionHandler {
  return ActionHandler.fromFunction(async (_actionTypeId, payload) => {
    const notice = noticeOf(payload);
    if (!notice) {
      console.warn('[shell] notify: payload refused', payload);
      return;
    }
    showNotice(notice);
  });
}
