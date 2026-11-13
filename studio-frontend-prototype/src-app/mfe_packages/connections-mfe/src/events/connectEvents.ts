/**
 * The Connect source form's own events.
 */

import '@gears-frontx/react';
import type { ConnectionDraft } from '../model/connectionDraft';

declare module '@gears-frontx/react' {
  interface EventPayloadMap {
    'mfe/connections/create-requested': { orgId: string; draft: ConnectionDraft };
    'mfe/connections/created': { id: string; label: string };
  }
}
