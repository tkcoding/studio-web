/**
 * How many items wait on the person (`GET /studio-user/v1/me/inbox`, ADR-0068
 * §6), for the top bar's Inbox button: one item of the open view, whose
 * `total` is the count. The list itself is the Inbox screen's
 * (organization-mfe), which reads the same route.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';

/** The part of the Inbox answer the count needs. */
export interface InboxTotal {
  total: number;
  unread: string[];
}

export class InboxCountApiService extends BaseApiService {
  constructor() {
    // The server reads every source before it answers.
    const restProtocol = new RestProtocol({ timeout: 60000 });
    super({ baseURL: '/cf/studio-user/v1' }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  readonly count = this.protocol(RestEndpointProtocol).query<InboxTotal>('/me/inbox?view=open&offset=0&limit=1');
}
