import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// A stand-in for lucide's loader, so the test sees what is asked for without
// loading an icon chunk.
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('lucide-react/dynamic', () => {
  loaded.count += 1;
  return {
    iconNames: ['users', 'settings'],
    DynamicIcon: ({ name, className }: { name: string; className?: string }) => (
      <svg data-icon={name} className={className} />
    ),
  };
});

import { ManifestIcon } from './ManifestIcon';

describe('ManifestIcon', () => {
  it('draws a lucide icon the manifest names, once the loader is there', async () => {
    const { container } = render(<ManifestIcon declared="lucide:users" className="glyph" />);
    await waitFor(() => expect(container.querySelector('svg[data-icon="users"]')).not.toBeNull());
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('glyph');
  });

  it('draws nothing for a name lucide does not have', async () => {
    const { container } = render(<ManifestIcon declared="lucide:userz" />);
    await waitFor(() => expect(loaded.count).toBe(1));
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws nothing, and loads nothing, for no icon or another set', () => {
    const { container } = render(
      <>
        <ManifestIcon declared={undefined} />
        <ManifestIcon declared="material-symbols:group" />
      </>
    );
    expect(container.innerHTML).toBe('');
  });
});
