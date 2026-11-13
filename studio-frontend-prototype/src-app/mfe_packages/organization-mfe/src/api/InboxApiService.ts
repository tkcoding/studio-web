/**
 * The person's Inbox (ADR-0068 §6): what waits on the caller across the
 * workspaces of their organization, and the marks they keep on it — both
 * studio-user's (`user_profile/rest.rs`). The caller is the person behind the
 * sign-in; no route names them.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { Inbox, InboxMark, InboxMarkState, InboxView } from '../inbox/types';

export interface InboxQuery {
  view: InboxView;
  offset: number;
  limit: number;
}

export interface InboxMarkBody {
  item_key: string;
  state: InboxMarkState;
  /** RFC 3339; required for `snoozed`. */
  until: string | null;
}

export class InboxApiService extends BaseApiService {
  constructor() {
    // The server reads every source of every workspace before it answers.
    const restProtocol = new RestProtocol({ timeout: 60000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);
    super({ baseURL: '/cf/studio-user/v1' }, restProtocol, restEndpoints);
  }

  /** One view of the Inbox: `open` (what waits, the server's order) or `hidden` (done or snoozed). */
  readonly inbox = this.protocol(RestEndpointProtocol).queryWith<Inbox, InboxQuery>(
    ({ view, offset, limit }) =>
      `/me/inbox?${new URLSearchParams({ view, offset: String(offset), limit: String(limit) })}`
  );

  /** Mark one item done, snooze it, or open it again. */
  readonly mark = this.protocol(RestEndpointProtocol).mutation<InboxMark, InboxMarkBody>('PUT', '/me/inbox-marks');
}
