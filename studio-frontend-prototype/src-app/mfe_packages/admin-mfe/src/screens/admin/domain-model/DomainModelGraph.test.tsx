import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { types, objects, service } = vi.hoisted(() => {
  const types = vi.fn(); const objects = vi.fn();
  return { types, objects, service: { domainModelGraph: types, domainObjectsGraph: objects } };
});
vi.mock('@gears-frontx/react', async (original) => ({
  ...(await original<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));
import { DomainModelGraph } from './DomainModelGraph';

beforeEach(() => {
  types.mockReset().mockReturnValue({ fetch: () => Promise.reject(new Error('Types unavailable')) });
  objects.mockReset().mockReturnValue({ fetch: () => Promise.reject(new Error('Objects unavailable')) });
});

describe('the organization model graph', () => {
  it('reads the administered organization and switches to its instance graph', async () => {
    render(<DomainModelGraph orgId="administered-org" />);
    await screen.findByText('Types unavailable');
    expect(types).toHaveBeenCalledWith({ orgId: 'administered-org' });
    expect(objects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dmg_instances' }));
    await screen.findByText('Objects unavailable');
    expect(screen.queryByText('Types unavailable')).toBeNull();
    expect(objects).toHaveBeenCalledWith({ orgId: 'administered-org' });
  });

  it('ignores a request that finishes after leaving the graph', async () => {
    let reject!: (error: Error) => void;
    types.mockReturnValue({ fetch: () => new Promise((_, fail) => { reject = fail; }) });
    const view = render(<DomainModelGraph orgId="o1" />);
    await waitFor(() => expect(types).toHaveBeenCalled());
    view.unmount();
    reject(new Error('Late refusal'));
    await Promise.resolve();
    expect(screen.queryByText('Late refusal')).toBeNull();
  });
});
