import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { previewFetch, addFetch } = vi.hoisted(() => ({
  previewFetch: vi.fn(),
  addFetch: vi.fn(),
}));

const ORG = 'org-1';

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({
      connections: () => ({
        fetch: () =>
          Promise.resolve({
            items: [
              { id: 'c-own', owner_tenant_id: ORG, provider: 'github', label: 'Acme GitHub', scope: 'organization' },
              { id: 'c-mine', owner_tenant_id: ORG, provider: 'github', label: 'Mine', scope: 'personal' },
              { id: 'c-root', owner_tenant_id: 'root', provider: 'github', label: 'Platform', scope: 'organization' },
              { id: 'c-llm', owner_tenant_id: ORG, provider: 'anthropic', label: 'Model', scope: 'organization' },
            ],
          }),
      }),
      previewShelfKit: () => ({ fetch: previewFetch }),
      addShelfKit: () => ({ fetch: addFetch }),
    }),
  },
}));

import { AddFromRepository } from './AddFromRepository';
import { shelfConnections } from '../../api/KitsApiService';

const KIT = {
  kit: { slug: 'ops', name: 'Ops runbooks', description: 'Runbooks', default_version: 'abc' },
  contents: {
    screens: [{ kind: 'tab', level: 'project', label: 'Runbooks', route: null, slot: null }],
    types: [],
    rules: [],
    functions: [],
    services: [],
    inbox: [],
    mcp_tools: [],
    permissions: { reads: [], writes: [], listens: [] },
    material: [],
    kinds: [],
    docs: [],
  },
  manifest: 'kit.json',
  origin: { commit: '0123456789abcdef', manifest_file: 'kit.json', repository: 'acme/kits', path: 'ops' },
};

describe('AddFromRepository', () => {
  it('offers only the organization\'s own shared repository connections', () => {
    const all = [
      { id: 'a', owner_tenant_id: ORG, provider: 'gitlab', label: 'a', scope: 'workspace' },
      { id: 'b', owner_tenant_id: ORG, provider: 'github', label: 'b', scope: 'personal' },
      { id: 'c', owner_tenant_id: 'other', provider: 'github', label: 'c', scope: 'organization' },
    ];
    expect(shelfConnections(all, ORG).map((c) => c.id)).toEqual(['a']);
  });

  it('reads the kit first, shows what it brings and its pin, then adds it', async () => {
    previewFetch.mockResolvedValue(KIT);
    addFetch.mockResolvedValue(KIT);
    const onAdded = vi.fn();
    render(<AddFromRepository organizationId={ORG} t={((k: string) => k) as never} onAdded={onAdded} onCancel={() => {}} />);

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['c-own']);

    const add = screen.getByRole('button', { name: 'add_confirm' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'acme/kits' } });
    fireEvent.change(inputs[1], { target: { value: 'ops' } });
    fireEvent.click(screen.getByRole('button', { name: 'add_read' }));

    expect(await screen.findByText('Ops runbooks')).toBeTruthy();
    expect(previewFetch).toHaveBeenCalledWith({ connection_id: 'c-own', repository: 'acme/kits', path: 'ops' });
    expect(screen.getByText('origin_pinned')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'add_confirm' }));
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(KIT));
  });

  it('shows the server\'s refusal', async () => {
    previewFetch.mockRejectedValue(new Error('a slug Studio already has'));
    render(<AddFromRepository organizationId={ORG} t={((k: string) => k) as never} onAdded={() => {}} onCancel={() => {}} />);
    await screen.findByRole('combobox');
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'acme/kits' } });
    fireEvent.click(screen.getByRole('button', { name: 'add_read' }));
    expect((await screen.findByRole('alert')).textContent).toContain('a slug Studio already has');
  });
});
