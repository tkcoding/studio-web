import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_CACHE_KEY, createPreferenceStore, type PreferencesClient } from './uiPreferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

function client(stored: Record<string, string> | Error = {}) {
  let answer: (value: Record<string, string>) => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const reading = new Promise<Record<string, string>>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  const c: PreferencesClient & { save: ReturnType<typeof vi.fn> } = {
    read: () => reading,
    save: vi.fn(() => Promise.resolve({})),
  };
  return {
    client: c,
    answer: async () => {
      if (stored instanceof Error) refuse(stored);
      else answer(stored);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('createPreferenceStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('paints from the browser mirror before the gear answers', () => {
    const storage = memoryStorage({ [PREFERENCES_CACHE_KEY]: JSON.stringify({ 'project.tabs.order': 'team,specs', n: 3 }) });
    const store = createPreferenceStore(client().client, { storage });
    expect(store.get()).toEqual({ 'project.tabs.order': 'team,specs' });
  });

  it('lets the gear replace the mirror once it answers', async () => {
    const storage = memoryStorage({ [PREFERENCES_CACHE_KEY]: JSON.stringify({ stale: 'x' }) });
    const gear = client({ 'project.tabs.order': 'team' });
    const store = createPreferenceStore(gear.client, { storage });
    const heard = vi.fn();
    store.subscribe(heard);
    void store.load();
    await gear.answer();
    expect(store.get()).toEqual({ 'project.tabs.order': 'team' });
    expect(JSON.parse(storage.data.get(PREFERENCES_CACHE_KEY)!)).toEqual({ 'project.tabs.order': 'team' });
    expect(heard).toHaveBeenCalled();
  });

  it('saves the whole map, once, after a burst of changes', async () => {
    const gear = client({ 'other.view': 'tiles' });
    const store = createPreferenceStore(gear.client, { storage: memoryStorage() });
    void store.load();
    await gear.answer();
    store.set('project.tabs.order', 'a,b');
    store.set('project.tabs.order', 'b,a');
    vi.advanceTimersByTime(500);
    expect(gear.client.save).toHaveBeenCalledTimes(1);
    expect(gear.client.save).toHaveBeenCalledWith({ 'other.view': 'tiles', 'project.tabs.order': 'b,a' });
  });

  it('forgets a key set to nothing', async () => {
    const gear = client({ 'project.tabs.order': 'b,a' });
    const store = createPreferenceStore(gear.client, { storage: memoryStorage() });
    void store.load();
    await gear.answer();
    store.set('project.tabs.order', '');
    vi.advanceTimersByTime(500);
    expect(gear.client.save).toHaveBeenCalledWith({});
  });

  it('saves nothing before the gear has answered, and nothing when it never does', async () => {
    const gear = client(new Error('404'));
    const store = createPreferenceStore(gear.client, { storage: memoryStorage() });
    void store.load();
    store.set('project.tabs.order', 'b,a');
    vi.advanceTimersByTime(500);
    await gear.answer();
    vi.advanceTimersByTime(500);
    expect(gear.client.save).not.toHaveBeenCalled();
    // The choice still holds for this session.
    expect(store.get()['project.tabs.order']).toBe('b,a');
  });

  it('lays a choice made during the load over the record, and saves it', async () => {
    const gear = client({ 'other.view': 'tiles', 'project.tabs.order': 'old' });
    const store = createPreferenceStore(gear.client, { storage: memoryStorage() });
    void store.load();
    store.set('project.tabs.order', 'new');
    await gear.answer();
    expect(store.get()).toEqual({ 'other.view': 'tiles', 'project.tabs.order': 'new' });
    expect(gear.client.save).toHaveBeenCalledWith({ 'other.view': 'tiles', 'project.tabs.order': 'new' });
  });

  it('reads the record once', async () => {
    const gear = client({});
    const read = vi.spyOn(gear.client, 'read');
    const store = createPreferenceStore(gear.client, { storage: memoryStorage() });
    void store.load();
    void store.load();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('ignores a change to the same value', () => {
    const store = createPreferenceStore(client().client, { storage: memoryStorage() });
    const heard = vi.fn();
    store.subscribe(heard);
    store.set('k', '');
    expect(heard).not.toHaveBeenCalled();
  });
});
