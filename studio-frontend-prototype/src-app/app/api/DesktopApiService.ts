/**
 * The desktops a project is open on (studio-session) and the commands sent to
 * one (studio-theia), for the editor's desktop hand-off (ADR-0027 §5–6).
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type { DesktopSession } from '@/app/desktop/desktopLink';

export class DesktopApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    super({ baseURL: '/cf' }, restProtocol, new RestEndpointProtocol(restProtocol));
  }

  /** Every desktop the project is open on, any member's. Read with `staleTime: 0`. */
  readonly sessions = this.protocol(RestEndpointProtocol).queryWith<
    { items: DesktopSession[]; total: number },
    { projectId: string }
  >(({ projectId }) => `/studio-session/v1/desktop-sessions?project_id=${encodeURIComponent(projectId)}&limit=200`);

  /** A command for a desktop the member holds open: it goes out on studio-events. 404 for an ended one. */
  command(desktopSessionId: string) {
    return this.protocol(RestEndpointProtocol).mutation<
      { command_id: string; desktop_session_id: string; command: string },
      { command: 'open_in_editor'; params: { relativePath: string } }
    >('POST', `/studio-theia/v1/desktop-sessions/${encodeURIComponent(desktopSessionId)}/commands`);
  }
}
