import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { session } = vi.hoisted(() => ({
  session: {
    accessor: undefined as
      | { getSession: () => Promise<unknown>; refresh?: () => Promise<unknown> }
      | undefined,
  },
}));
vi.mock('@constructor-studio/mfe-shared', () => ({ readSharedAuthSession: () => session.accessor }));

import { DownloadError, downloadReport, fetchBlob } from './download';
import { orgQuery, reportPath } from './ReportsApiService';

const fetchMock = vi.fn();

describe('report paths', () => {
  it('name the organization on every route', () => {
    expect(reportPath('roadmap', '/plan/people', 'o 1')).toBe('/studio-reports/v1/reports/roadmap/plan/people?organization_id=o%201');
    expect(orgQuery('o1', '&')).toBe('&organization_id=o1');
  });
});

describe('fetchBlob', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    session.accessor = { getSession: () => Promise.resolve({ kind: 'bearer', token: 'tok' }) };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the host session as a bearer under the gateway prefix', async () => {
    fetchMock.mockResolvedValue(new Response('xlsx'));
    const blob = await fetchBlob('/studio-reports/v1/reports/roadmap/workbook');
    expect(blob.size).toBe(4);
    expect(fetchMock).toHaveBeenCalledWith('/cf/studio-reports/v1/reports/roadmap/workbook', {
      headers: { Authorization: 'Bearer tok' },
      credentials: 'same-origin',
    });
  });

  it('asks the host to refresh once on a 401', async () => {
    session.accessor = {
      getSession: () => Promise.resolve({ kind: 'bearer', token: 'old' }),
      refresh: () => Promise.resolve({ kind: 'bearer', token: 'new' }),
    };
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('ok'));
    await fetchBlob('/x');
    expect(fetchMock.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer new' }, credentials: 'same-origin' });
  });

  it("rejects with the server's own words", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'no board synced yet' }), { status: 409, statusText: 'Conflict' })
    );
    const error = await fetchBlob('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).status).toBe(409);
    expect((error as DownloadError).message).toBe('no board synced yet');
  });

  it('names the workbook after the report and the date it is drawn as of', async () => {
    fetchMock.mockResolvedValue(new Response('xlsx'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const created: HTMLAnchorElement[] = [];
    const make = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = make(tag);
      if (el instanceof HTMLAnchorElement) created.push(el);
      return el;
    });
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    await downloadReport('o1', 'roadmap', '2026-11-09');
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/cf/studio-reports/v1/reports/roadmap/workbook?date=2026-11-09&organization_id=o1'
    );
    expect(created[0].download).toBe('back_roadmap_2026-11-09.xlsx');
    expect(click).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
