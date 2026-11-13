/** Connect source's own events, and a source's "Changes" on the Sources list. */

import '@gears-frontx/react';
import type { RepositoryPick } from '../model/projectDraft';
import type { ShareMode } from '../model/projectSources';

declare module '@gears-frontx/react' {
  interface EventPayloadMap {
    'mfe/projects/source-share-mode-requested': {
      projectId: string;
      rowId: string;
      connectionId: string;
      fullPath: string;
      mode: ShareMode;
    };
    'mfe/projects/sources-connect-requested': { projectId: string; picks: RepositoryPick[] };
    'mfe/projects/sources-connected': { projectId: string };
  }
}
