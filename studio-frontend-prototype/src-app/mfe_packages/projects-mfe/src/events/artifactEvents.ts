/**
 * The import's own event. Declared apart from `projectsEvents` because it
 * carries a payload the nav events do not: everything the gear needs to pull a
 * repository, resolved by the component that has the connections.
 */

import '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';

export interface SyncRepo {
  repo: string;
  provider: string;
  baseUrl?: string;
  secretRef: string;
}

export interface SyncRequest {
  projectId: string;
  workspaceId: string | null;
  repos: SyncRepo[];
  /** Sources with no task to wait for, and why. */
  unsyncable: { repo: string; reason: Refusal }[];
}

/** One repository of a project's import. */
export interface RepoRef {
  projectId: string;
  repo: string;
}

/** The gear's no to a cancel or a retry, for the screen to show. */
export interface RepoRefusal extends RepoRef {
  refusal: Refusal;
}

declare module '@gears-frontx/react' {
  interface EventPayloadMap {
    /** Pull these repositories into this project's graph. */
    'mfe/artifacts/sync-requested': SyncRequest;
    /** Add these repositories to the project's import, beside the ones it already follows. */
    'mfe/artifacts/repos-added': SyncRequest;
    /** Stop this repository's sync. */
    'mfe/artifacts/cancel-requested': RepoRef;
    /** Put this repository's failed or cancelled sync back on the queue. */
    'mfe/artifacts/retry-requested': RepoRef;
    /** The gear would not stop this repository's sync. */
    'mfe/artifacts/cancel-refused': RepoRefusal;
    /** The gear would not put this repository's sync back on the queue. */
    'mfe/artifacts/retry-refused': RepoRefusal;
  }
}
