import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { service, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  calls: [] as { what: string; orgId: string; body?: unknown }[],
}));
vi.mock('@gears-frontx/react', async (original) => ({
  ...(await original<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
vi.mock('./DomainModelGraph', () => ({ DomainModelGraph: () => <div>graph</div> }));
import { DomainModelTools } from './DomainModelTools';

const changed = vi.fn();
const revision = (version: number, undo: unknown[] = [{ op: 'remove' }]) => ({
  version, undo, patch: [], at: '2026-11-10T10:00:00Z', by: 'Ann', op: 'add_field', target: 'project', summary: `Change ${version}`,
});
const history = (revisions = [revision(3), revision(2), revision(1)]) => {
  service.domainHistory = ({ orgId }: { orgId: string }) => ({ fetch: async () => {
    calls.push({ what: 'history', orgId }); return { head: 3, revisions };
  } });
};
beforeEach(() => {
  calls.length = 0; changed.mockClear(); history();
  service.revertDomainModel = (orgId: string) => ({ fetch: async (body: unknown) => { calls.push({ what: 'revert', orgId, body }); } });
  service.importDomainModel = (orgId: string) => ({ fetch: async (body: unknown) => { calls.push({ what: 'import', orgId, body }); } });
});

describe('domain model tools', () => {
  it('loads history for the administered organization only when opened, and confirms a revert', async () => {
    render(<DomainModelTools orgId="other-org" canEdit onChanged={changed} />);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByText('dm_tools_history'));
    await screen.findByText('Change 2');
    expect(calls[0]).toEqual({ what: 'history', orgId: 'other-org' });
    fireEvent.click(screen.getAllByText('dm_revert')[0]);
    expect(calls.some((c) => c.what === 'revert')).toBe(false);
    fireEvent.click(document.querySelector('[data-admin-confirm-go]') as HTMLElement);
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(calls).toContainEqual({ what: 'revert', orgId: 'other-org', body: { to: 2 } });
  });

  it('prevents reverting across a model import without an inverse', async () => {
    history([revision(3), revision(2, []), revision(1)]);
    render(<DomainModelTools orgId="o1" canEdit onChanged={changed} />);
    fireEvent.click(screen.getByText('dm_tools_history'));
    const row = (await screen.findByText('Change 1')).closest('tr')!;
    expect((within(row).getByRole('button', { name: 'dm_revert' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not offer writes to a reader', async () => {
    render(<DomainModelTools orgId="o1" canEdit={false} onChanged={changed} />);
    fireEvent.click(screen.getByText('dm_tools_history'));
    await screen.findByText('Change 1');
    expect(screen.queryByText('dm_revert')).toBeNull();
    fireEvent.click(screen.getByText('dm_tools_transfer'));
    expect(screen.queryByText('dm_import')).toBeNull();
    expect(screen.getByText('dm_export')).toBeTruthy();
  });

  it('rejects a malformed import before asking for a destructive write', async () => {
    render(<DomainModelTools orgId="o1" canEdit onChanged={changed} />);
    fireEvent.click(screen.getByText('dm_tools_transfer'));
    const file = new File(['{}'], 'wrong.json');
    Object.defineProperty(file, 'text', { value: async () => '{}' });
    fireEvent.change(screen.getByLabelText('dm_import'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'dm_import_invalid');
    expect(document.querySelector('[data-admin-confirm-go]')).toBeNull();
    expect(calls.some((c) => c.what === 'import')).toBe(false);
  });
});
