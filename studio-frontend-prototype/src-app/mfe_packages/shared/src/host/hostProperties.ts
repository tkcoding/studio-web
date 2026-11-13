/**
 * The shared-property ids the MFEs read from the shell. The shell is the only
 * publisher; nothing here derives an answer of its own.
 */

/** Tenant id of the open project, or `null` at organization scope. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.project.selected.v1~';

/** `{id, name}` of the organization in scope, or `null` when there is none. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.organization.selected.v1~';

/** `{id, displayName?, email?}` of the signed-in subject, or `null`. */
export const STUDIO_SHARED_PROPERTY_SESSION_PROFILE =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.session.user.profile.v1~';

/** The tabs' chosen section of the level in scope, as the token declared on that item, or `null`. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_SECTION =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.project_section.selected.v1~';

/** `{id, name}` of the workspace in scope, or `null` when the organization has none. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.workspace.selected.v1~';

/** `{artifactId, repository, path, kind}` of the artifact the editor is on, or `null` outside it. */
export const STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.artifact.selected.v1~';

/**
 * The address the frame of a frame-entry micro-frontend loads (ADR-0021).
 * The entry names this property rather than carrying an address, so the
 * loader knows nothing about who answers it: a static page today (#321),
 * the session gate's per-session address once #322 replaces that seed. What
 * happens across the boundary once something is loaded is #323, a separate
 * step again.
 */
export const STUDIO_SHARED_PROPERTY_SPACE_FRAME_URL =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.space.mfe.frame_url.v1~';

/**
 * The last event the shell's one `studio-events` subscription received
 * (`StudioEvent`), or `null` before the first. The shell holds the only
 * connection for the signed-in person and relays every frame here, so a
 * screen is told that something happened without opening a stream of its own
 * (`useStudioEventRefresh`). A signal to reload, not a log: a screen that
 * mounts sees only the newest one, and a burst may coalesce.
 */
export const STUDIO_SHARED_PROPERTY_LIVE_EVENT =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.live.studio_events.last_event.v1~';

/**
 * Which screens a micro-frontend may send the person to right now
 * (`AvailableScreens`), or `null` before the shell knows: a kit's screen only
 * where its kit is installed (ADR-0068 §5), so a row's button never leads to a
 * tab that is not there. Read with `useScreenAvailability`.
 */
export const STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.screens.available.v1~';
