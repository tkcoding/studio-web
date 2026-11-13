// The portal → IDE hand-off, as ONE seam instead of two buttons.
//
// Before this module the portal had two unrelated gestures: "Open in IDE",
// which launched a session and mounted its space, and the per-file actions
// (`studio.openInEditor`, `studio.openGraph`), which posted into every mounted
// iframe and silently did nothing when no session happened to be open. So
// "open the IDE" and "edit this thing in the IDE" were separate clicks, in
// that order, and the second one only worked after the first.
//
// Here they become one call: ask for a document/file/graph and the portal
//   1. reuses a live session for the target, or launches one and waits for it
//      to become reachable,
//   2. mounts/activates its space (the iframe stays mounted, so no reload),
//   3. delivers the message once the IDE's portal-bridge answers the
//      handshake — messages sent before that are queued, not lost.
//
// The implementation lives in `App` because it owns the spaces state; this
// file holds the contract and the context so any view can reach it without
// threading callbacks through every layer of the tree.
import { createContext, useContext } from "react";

import type { RepoEntry } from "./api";

/** What an IDE hand-off launches against.
 *
 *  A root project passes itself (a Workspace already has id + name). A nested
 *  project passes its OWN id and its single source as the root repo, so each
 *  project gets its own session (keyed by id) cloning its own content. The
 *  session gear treats `workspace_id` as an opaque per-session key — directory
 *  name, pod label, idempotency — and does not require it to be a tenant, so
 *  no tenant is created for a nested project. */
export type StudioTarget = {
  id: string;
  name: string;
  /** Explicit repo set; when omitted the launcher reads workspaceSettings(id). */
  repos?: RepoEntry[];
  /** Root repo/path override; when omitted taken from workspaceSettings(id). */
  root?: { path?: string; repoUrl?: string; branch?: string; tokenRef?: string };
  /** True when this is a nested project (no workspaceSettings of its own). */
  standalone?: boolean;
};

/** How the IDE addresses a document: the storage tenant (the parent workspace
 *  whose `studio-documents` rows hold it — NOT the project the document is
 *  shown under) plus the document id. The IDE turns the pair into a
 *  `studio-doc:` URI and edits it with its markdown editor. */
export interface StudioDocumentRef {
  workspaceId: string;
  id: string;
  title?: string;
}

/** A document the IDE has just written back through the documents gear. */
export interface SavedDocument {
  workspaceId: string;
  documentId: string;
  /** Monotonic stamp — views re-read when it changes. */
  at: number;
}

export interface StudioBridge {
  /** Open (and edit) a portal document in the IDE's markdown editor. */
  openDocument(target: StudioTarget, doc: StudioDocumentRef): Promise<void>;
  /** Open a checkout-relative repository file in the IDE's editor. */
  openFile(target: StudioTarget, path: string): Promise<void>;
  /** Open a checkout-relative product.gdl in the IDE's Gearbox perspective,
   *  through Gearbox (resolved, with its graph, lock and conflicts). An IDE
   *  without Gearbox opens it as a file. */
  /** `branch`: where the portal saved the description, when that is not the
   *  branch a session checks out; the IDE brings it in beside the checkout. */
  openProduct(target: StudioTarget, path: string, branch?: string): Promise<void>;
  /** Open the IDE's Artifact Graph view. */
  openGraph(target: StudioTarget): Promise<void>;
  /** Start the target's session now, in the background, so that the IDE is
   *  already up when someone asks for a document in it. Mounts nothing and
   *  reports nothing: a failure here is the next open's to show. */
  prewarm(target: StudioTarget): void;
  /** The target currently being launched, if any — for button spinners. */
  opening: string | null;
  /** True once the target has a mounted space, so callers can say "switch to"
   *  instead of "open" without duplicating the spaces state. */
  isOpen(targetId: string): boolean;
  /** The last write the IDE reported; documents views revalidate on it. */
  savedDocument: SavedDocument | null;
}

const StudioBridgeContext = createContext<StudioBridge | null>(null);

export const StudioBridgeProvider = StudioBridgeContext.Provider;

/** Null outside the portal shell (tests, storybook-style renders) — every
 *  caller treats that as "no IDE available" rather than crashing. */
export function useStudioBridge(): StudioBridge | null {
  return useContext(StudioBridgeContext);
}
