import { describe, expect, it, vi } from 'vitest';
import { createLogoStore, logoSrc } from './orgLogo';

describe('organization logos', () => {
  it('reads each organization once and remembers none for a 404', async () => {
    const reader = vi.fn((orgId: string) =>
      orgId === 'a' ? Promise.resolve({ content_type: 'image/webp', data: 'QQ==' }) : Promise.reject(new Error('404'))
    );
    const store = createLogoStore(reader);
    const heard = vi.fn();
    store.subscribe(heard);
    store.read('a');
    store.read('a');
    store.read('b');
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(2));
    expect(reader).toHaveBeenCalledTimes(2);
    expect(store.get('a')).toBe('data:image/webp;base64,QQ==');
    expect(store.get('b')).toBeNull();
    store.read('b');
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('reads nothing without the organizations service', () => {
    const store = createLogoStore(null);
    store.read('a');
    expect(store.get('a')).toBeUndefined();
  });

  it('builds a data URL', () => {
    expect(logoSrc({ content_type: 'image/png', data: 'AA' })).toBe('data:image/png;base64,AA');
  });
});
