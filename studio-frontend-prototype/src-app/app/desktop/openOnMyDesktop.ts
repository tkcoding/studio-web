/**
 * A project's file, opened on the member's own desktop when the project is
 * open there (ADR-0027 §5): the command goes out on studio-events and the
 * desktop opens the file. The device it went to, or `undefined` when there is
 * none (or this Studio has no desktop sessions) and the caller opens it
 * another way.
 */

import { apiRegistry } from '@gears-frontx/react';
import { DesktopApiService } from '@/app/api/DesktopApiService';
import { myDesktop } from './desktopLink';

export async function openOnMyDesktop(
  projectId: string,
  path: string,
  me: string | undefined
): Promise<string | undefined> {
  if (!me || !apiRegistry.has(DesktopApiService)) return undefined;
  const desktops = apiRegistry.getService(DesktopApiService);
  let desktop;
  try {
    desktop = myDesktop((await desktops.sessions({ projectId }).fetch({ staleTime: 0 }))?.items ?? [], me);
  } catch {
    return undefined;
  }
  if (!desktop) return undefined;
  try {
    await desktops.command(desktop.id).fetch({ command: 'open_in_editor', params: { relativePath: path } });
  } catch {
    return undefined;
  }
  return desktop.device_name?.trim() || 'your desktop';
}
