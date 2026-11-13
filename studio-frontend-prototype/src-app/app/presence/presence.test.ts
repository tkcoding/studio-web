import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BEAT_MS, PLACE_SETTLE_MS, appendNotes, dismissNote, placeOf, usePresence, type PresenceClient } from './presence';
import type { PresenceNote } from '@/app/api/PresenceApiService';

const note = (id: string, text = id): PresenceNote => ({ id, from_user_id: 'u2', text, sent_ms: 1 });

describe('presence notes', () => {
  it('appends what arrives, once each, and keeps what is on screen', () => {
    const shown = [note('a')];
    expect(appendNotes(shown, [])).toBe(shown);
    expect(appendNotes(shown, [note('a'), note('b')]).map((n) => n.id)).toEqual(['a', 'b']);
    expect(dismissNote([note('a'), note('b')], 'a').map((n) => n.id)).toEqual(['b']);
  });

  it('says where the person is: the section, else the level, with the project or workspace', () => {
    expect(placeOf({ section: 'specs', level: 'project', project: { name: 'Web' }, workspace: { name: 'Team' } })).toEqual({
      place: 'specs',
      detail: 'Web',
    });
    expect(placeOf({ section: null, level: 'admin', workspace: { name: 'Team' } })).toEqual({ place: 'admin', detail: 'Team' });
    expect(placeOf({})).toEqual({ place: 'studio' });
  });
});

describe('usePresence', () => {
  /** Lets the place hold long enough to be reported. */
  const settle = () =>
    act(async () => {
      vi.advanceTimersByTime(PLACE_SETTLE_MS);
    });

  let client: PresenceClient & { beat: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    client = {
      beat: vi.fn().mockResolvedValue({ messages: [], online: 3 }),
      leave: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('beats once the place holds, with who and where, then every BEAT_MS, and leaves on unmount', async () => {
    const { result, unmount } = renderHook(() => usePresence({ displayName: 'Ann', place: 'specs', detail: 'Web' }, client));
    await settle();
    expect(client.beat).toHaveBeenCalledWith({ display_name: 'Ann', place: 'specs', detail: 'Web' });
    expect(result.current.online).toBe(3);
    const before = client.beat.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(BEAT_MS);
    });
    expect(client.beat.mock.calls.length).toBe(before + 1);
    unmount();
    expect(client.leave).toHaveBeenCalled();
  });

  it('beats again when the person moves and the new place holds', async () => {
    const { rerender } = renderHook(({ place }) => usePresence({ place }, client), { initialProps: { place: 'specs' } });
    await settle();
    client.beat.mockClear();
    rerender({ place: 'issues' });
    await settle();
    expect(client.beat).toHaveBeenCalledWith({ display_name: undefined, place: 'issues', detail: undefined });
  });

  it('reports only where a quick walk of places ends: one beat, not one per place', async () => {
    const { rerender } = renderHook(({ place }) => usePresence({ place }, client), { initialProps: { place: 'studio' } });
    rerender({ place: 'organization' });
    rerender({ place: 'overview' });
    await settle();
    expect(client.beat).toHaveBeenCalledTimes(1);
    expect(client.beat).toHaveBeenCalledWith({ display_name: undefined, place: 'overview', detail: undefined });
  });

  it('collects the notes a beat hands over, and dismisses one', async () => {
    client.beat.mockResolvedValueOnce({ messages: [note('n1', 'Lunch?')], online: 2 });
    const { result } = renderHook(() => usePresence({ place: 'specs' }, client));
    await settle();
    expect(result.current.notes.map((n) => n.text)).toEqual(['Lunch?']);
    act(() => result.current.dismiss('n1'));
    expect(result.current.notes).toEqual([]);
  });

  it('stays quiet when the gear is not there', async () => {
    client.beat.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => usePresence({ place: 'specs' }, client));
    await settle();
    expect(client.beat).toHaveBeenCalled();
    expect(result.current.notes).toEqual([]);
    expect(result.current.online).toBe(0);
  });

  it('does nothing without a client', async () => {
    const { result } = renderHook(() => usePresence({ place: 'specs' }, null));
    await act(async () => {
      vi.advanceTimersByTime(BEAT_MS);
    });
    expect(result.current.notes).toEqual([]);
  });
});
