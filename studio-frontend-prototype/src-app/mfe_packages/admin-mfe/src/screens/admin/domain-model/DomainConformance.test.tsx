import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, fetch, service } = vi.hoisted(() => {
  const fetch = vi.fn(); const query = vi.fn(() => ({ fetch }));
  return { query, fetch, service: { domainConformance: query } };
});
vi.mock('@gears-frontx/react', async (original) => ({
  ...(await original<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
vi.mock('../common', async (original) => ({
  ...(await original<typeof import('../common')>()),
  useAdmin: () => ({ t: (key: string, params?: unknown) => params ? `${key} ${JSON.stringify(params)}` : key }),
}));
import { DomainConformance } from './DomainConformance';

const report = {
  type: 'project', checked: 100, conforming: 97, truncated: true,
  violations: [{ field: 'title', kind: 'missing', count: 3 }],
  undeclared: [{ field: 'old_title', kind: null, count: 2 }],
  sample: [{ instance_id: 'project:one', violations: ['title is missing'] }],
};
beforeEach(() => { query.mockClear(); fetch.mockReset().mockResolvedValue(report); });

describe('stored object conformance', () => {
  it('checks only on request and names the administered organization and selected type', async () => {
    render(<DomainConformance orgId="other-org" typeId="project" />);
    expect(query).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    expect(await screen.findByText(/dm_conformance_summary/)).toHaveProperty('textContent', 'dm_conformance_summary {"checked":"100","conforming":"97"}');
    expect(query).toHaveBeenCalledWith({ orgId: 'other-org', typeId: 'project' });
    expect(screen.getByRole('status').textContent).toBe('dm_conformance_partial');
    expect(screen.getByText('dm_conformance_missing')).toBeTruthy();
    expect(screen.getByText('dm_conformance_undeclared')).toBeTruthy();
    expect(screen.getByText('old_title')).toBeTruthy();
    expect(screen.getByText('project:one')).toBeTruthy();
  });

  it('shows an empty check without claiming that objects exist', async () => {
    fetch.mockResolvedValue({ ...report, checked: 0, conforming: 0, truncated: false, violations: [], undeclared: [], sample: [] });
    render(<DomainConformance orgId="o1" typeId="file" />);
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    expect(await screen.findByText('dm_conformance_empty')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server refusal and permits retrying the read', async () => {
    fetch.mockRejectedValueOnce(new Error('Organization access denied'));
    render(<DomainConformance orgId="o1" typeId="file" />);
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Organization access denied');
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    await screen.findByText(/dm_conformance_summary/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('discards a result that arrives after leaving the selected type', async () => {
    let resolve!: (value: typeof report) => void;
    fetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<DomainConformance orgId="o1" typeId="file" />);
    fireEvent.click(screen.getByRole('button', { name: 'dm_conformance' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    view.unmount(); resolve(report); await Promise.resolve();
    expect(screen.queryByText(/dm_conformance_summary/)).toBeNull();
  });
});
