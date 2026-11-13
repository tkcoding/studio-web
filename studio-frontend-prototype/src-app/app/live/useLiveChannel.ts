/** React's side of the shell's live channel. */

import { useEffect, useRef } from 'react';
import { useAppSelector } from '@gears-frontx/react';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import type { StudioEvent } from '@constructor-studio/mfe-shared';
import { liveChannel } from './liveChannel';

/** Keeps the channel open while the calling component (the signed-in Layout) is mounted. */
export function useLiveChannelOpen(): void {
  useEffect(() => liveChannel()?.start(), []);
}

/**
 * Points the channel at the organization on screen (`null`: the person's home
 * tenant) while the caller is mounted. The Layout passes the path bar's
 * organization, so a switch there switches what every screen hears.
 */
export function useLiveChannelScope(organizationId: string | null): void {
  useEffect(() => {
    liveChannel()?.setScope(organizationId);
  }, [organizationId]);
}

/** Points the channel at the path bar's organization while the caller (the Layout) is mounted. */
export function useLiveChannelFollowsOrganization(): void {
  const organizationId = useAppSelector(
    (state) => (state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined)?.org?.id ?? null
  );
  useLiveChannelScope(organizationId);
}

/** Hears every new event the channel delivers while the caller is mounted. */
export function useStudioEvents(listener: (event: StudioEvent) => void): void {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => liveChannel()?.subscribe((event) => latest.current(event)), []);
}
