/**
 * Everything the shell tells the MFEs about itself, in one place.
 */

import type { FrontXApp } from '@gears-frontx/react';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT,
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  STUDIO_SHARED_PROPERTY_SESSION_PROFILE,
  STUDIO_SHARED_PROPERTY_SPACE_FRAME_URL,
  STUDIO_SHARED_PROPERTY_LIVE_EVENT,
  STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE,
  type AvailableScreens,
  type StudioEvent,
} from '@constructor-studio/mfe-shared';
import { readAppContext } from '@/app/slices/appContextSlice';
import { readSessionProfile } from '@/app/slices/appSessionSlice';

function publish(app: FrontXApp, propertyId: string, value: unknown): void {
  try {
    app.mfeRegistry?.updateSharedProperty(propertyId, value);
  } catch (error) {
    console.warn(
      `Failed to publish ${propertyId} to MFEs:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function publishSelectedProject(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, readAppContext(app).project?.id ?? null);
}

export function publishSelectedSection(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_CONTEXT_SECTION, readAppContext(app).section ?? null);
}

export function publishSelectedArtifact(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT, readAppContext(app).artifact ?? null);
}

export function publishSelectedOrganization(app: FrontXApp): void {
  const org = readAppContext(app).org ?? null;
  publish(
    app,
    STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
    org ? { id: org.id, name: org.name } : null
  );
}

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-shell-owns:p1
export function publishSelectedWorkspace(app: FrontXApp): void {
  const workspace = readAppContext(app).workspace ?? null;
  publish(
    app,
    STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
    workspace ? { id: workspace.id, name: workspace.name } : null
  );
}

export function publishSessionProfile(app: FrontXApp): void {
  publish(app, STUDIO_SHARED_PROPERTY_SESSION_PROFILE, readSessionProfile(app));
}

// @cpt-dod:cpt-studiofrontend-dod-editor-session-address:p1
/**
 * The address a frame-entry MFE loads: `null` from start-up, the editor's
 * session once it is ready (effects/editorSessionEffects.ts). A parameter, not
 * a slice read: the address carries the gate's token and stays out of the
 * store.
 */
export function publishFrameUrl(app: FrontXApp, url: string | null): void {
  publish(app, STUDIO_SHARED_PROPERTY_SPACE_FRAME_URL, url);
}

/**
 * The last frame of the shell's live channel (`app/live/liveChannel.ts`), or
 * `null` before one. A parameter, like the frame address: the events stay out
 * of the store.
 */
export function publishLiveEvent(app: FrontXApp, event: StudioEvent | null): void {
  publish(app, STUDIO_SHARED_PROPERTY_LIVE_EVENT, event);
}

export function publishStudioContext(app: FrontXApp): void {
  publishSelectedOrganization(app);
  publishSelectedWorkspace(app);
  publishSelectedProject(app);
  publishSelectedSection(app);
  publishSelectedArtifact(app);
  publishSessionProfile(app);
}

/**
 * Which screens the micro-frontends may send the person to now
 * (`app/layout/AvailableScreens.tsx`), or `null` before the shell knows.
 */
export function publishAvailableScreens(app: FrontXApp, available: AvailableScreens | null): void {
  publish(app, STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE, available);
}
