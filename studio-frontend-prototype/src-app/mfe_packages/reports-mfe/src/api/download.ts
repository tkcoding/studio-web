/**
 * The two files Organization › Reports hands out: the report's workbook
 * (`.xlsx`, as the server draws it) and the plan as `gears.yaml`.
 *
 * Not through the REST protocol: it reads every answer as text, which mangles
 * a binary workbook, and its descriptors take no response type. So these go
 * through `fetch`, with the host's session the way `authShared()` reads it: a
 * bearer token in the header, or the session cookie on the same origin. A 401
 * asks the host to refresh once, as the shared auth plugin does.
 */

import { readSharedAuthSession } from '@constructor-studio/mfe-shared';
import { REPORTS_PATH, orgQuery } from './ReportsApiService';

/** The gateway prefix every gear is reached under. */
const GATEWAY = '/cf';

/** A refused download: its status and the server's own words, when it gave some. */
export class DownloadError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

async function authHeaders(refreshed = false): Promise<Record<string, string>> {
  const accessor = readSharedAuthSession();
  if (!accessor) return {};
  const session = refreshed && accessor.refresh ? await accessor.refresh() : await accessor.getSession();
  return session?.kind === 'bearer' && session.token ? { Authorization: `Bearer ${session.token}` } : {};
}

/** The server's `detail` (problem+json) or its text, else the status line. */
async function failure(res: Response): Promise<DownloadError> {
  const text = await res.text().catch(() => '');
  let message = text.trim();
  try {
    const body = JSON.parse(text) as { detail?: unknown; title?: unknown; message?: unknown };
    const said = body.detail ?? body.message ?? body.title;
    if (typeof said === 'string' && said) message = said;
  } catch {
    // Not JSON: the text itself.
  }
  return new DownloadError(res.status, message || `${res.status} ${res.statusText}`.trim());
}

/** GET `path` (under the gateway) as a blob, with the host's session. */
export async function fetchBlob(path: string): Promise<Blob> {
  const url = `${GATEWAY}${path}`;
  let res = await fetch(url, { headers: await authHeaders(), credentials: 'same-origin' });
  if (res.status === 401 && readSharedAuthSession()?.refresh) {
    res = await fetch(url, { headers: await authHeaders(true), credentials: 'same-origin' });
  }
  if (!res.ok) throw await failure(res);
  return res.blob();
}

/** Hand a blob to the browser as a file named `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Today, `YYYY-MM-DD`: the date a workbook is drawn as of. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Save the report's workbook as the server draws it, as of `asOf`. */
export async function downloadReport(organizationId: string, report = 'roadmap', asOf = today()): Promise<void> {
  const blob = await fetchBlob(
    `${REPORTS_PATH}/${encodeURIComponent(report)}/workbook?date=${encodeURIComponent(asOf)}${orgQuery(organizationId, '&')}`
  );
  saveBlob(blob, `back_${report}_${asOf}.xlsx`);
}

/** Save the report's plan as `gears.yaml`. */
export async function downloadPlan(organizationId: string, report: string): Promise<void> {
  const blob = await fetchBlob(`${REPORTS_PATH}/${encodeURIComponent(report)}/plan/yaml${orgQuery(organizationId)}`);
  saveBlob(blob, 'gears.yaml');
}
