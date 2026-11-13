import { describe, expect, it, vi } from 'vitest';
import type { StudioEvent } from '@constructor-studio/mfe-shared';
import { createLiveChannel, type LiveStream } from './liveChannel';

function event(seq: number): StudioEvent {
  return { seq, at_ms: seq, kind: 'task.succeeded', subject_type: 'task_run', subject_id: `r${seq}`, source: 'x', payload: {} };
}

function fakeStream() {
  let onEvent: ((event: StudioEvent) => void) | null = null;
  let onComplete: (() => void) | undefined;
  const stream: LiveStream = {
    connect: vi.fn((handler: (event: StudioEvent) => void, complete?: () => void) => {
      onEvent = handler;
      onComplete = complete;
      return Promise.resolve('c1');
    }),
    disconnect: vi.fn(),
  };
  return {
    stream,
    emit: (e: StudioEvent) => onEvent?.(e),
    complete: () => onComplete?.(),
  };
}

function setup() {
  const fake = fakeStream();
  const publish = vi.fn();
  const warn = vi.fn();
  const channel = createLiveChannel({ stream: () => fake.stream, publish, warn });
  return { fake, publish, warn, channel };
}

describe('createLiveChannel', () => {
  it('opens one connection however many users start it', () => {
    const { fake, channel } = setup();
    channel.start();
    channel.start();
    expect(fake.stream.connect).toHaveBeenCalledTimes(1);
    expect(channel.status()).toBe('open');
  });

  it('closes after the last user releases it, and only then', async () => {
    const { fake, channel } = setup();
    const a = channel.start();
    const b = channel.start();
    a();
    a(); // a second release of the same user counts once
    await Promise.resolve();
    expect(fake.stream.disconnect).not.toHaveBeenCalled();
    b();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.stream.disconnect).toHaveBeenCalledWith('c1');
    expect(channel.status()).toBe('idle');
  });

  it('relays each new event to the screens and to the shell listeners', () => {
    const { fake, publish, channel } = setup();
    const heard = vi.fn();
    channel.subscribe(heard);
    channel.start();
    fake.emit(event(1));
    expect(publish).toHaveBeenCalledWith(event(1));
    expect(heard).toHaveBeenCalledWith(event(1));
  });

  it('hands an event over once, in order: a replay that overlaps the stream is dropped', () => {
    const { fake, publish, channel } = setup();
    channel.start();
    fake.emit(event(2));
    fake.emit(event(2));
    fake.emit(event(1));
    fake.emit(event(3));
    expect(publish.mock.calls.map(([e]) => (e as StudioEvent).seq)).toEqual([2, 3]);
  });

  it('starts the cursor over for the next session', () => {
    const { fake, publish, channel } = setup();
    const release = channel.start();
    fake.emit(event(9));
    release();
    channel.start();
    fake.emit(event(1));
    expect(publish).toHaveBeenLastCalledWith(event(1));
  });

  it('keeps going when one listener throws', () => {
    const { fake, warn, channel } = setup();
    const after = vi.fn();
    channel.subscribe(() => {
      throw new Error('boom');
    });
    channel.subscribe(after);
    channel.start();
    fake.emit(event(1));
    expect(after).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('says the stream ended for good', () => {
    const { fake, channel } = setup();
    channel.start();
    fake.complete();
    expect(channel.status()).toBe('closed');
  });

  it('breaks nothing where the events service is missing', () => {
    const publish = vi.fn();
    const warn = vi.fn();
    const channel = createLiveChannel({
      stream: () => {
        throw new Error('no service');
      },
      publish,
      warn,
    });
    expect(() => channel.start()).not.toThrow();
    expect(channel.status()).toBe('closed');
    expect(warn).toHaveBeenCalled();
  });

  describe('the organization on screen', () => {
    function scoped() {
      const streams = new Map<string, ReturnType<typeof fakeStream>>();
      const opened: (string | null)[] = [];
      const publish = vi.fn();
      const channel = createLiveChannel({
        stream: (org) => {
          opened.push(org);
          const fake = fakeStream();
          streams.set(org ?? 'home', fake);
          return fake.stream;
        },
        publish,
        warn: vi.fn(),
      });
      return { streams, opened, publish, channel };
    }

    it("listens to the home tenant until an organization is named, then to that organization's", async () => {
      const { streams, opened, channel } = scoped();
      channel.start();
      expect(opened).toEqual([null]);
      channel.setScope('org-a');
      expect(opened).toEqual([null, 'org-a']);
      expect(channel.scope()).toBe('org-a');
      await Promise.resolve();
      await Promise.resolve();
      expect(streams.get('home')?.stream.disconnect).toHaveBeenCalledWith('c1');
    });

    it('opens nothing for a scope set before anybody started it, and uses it at the start', () => {
      const { opened, channel } = scoped();
      channel.setScope('org-a');
      expect(opened).toEqual([]);
      channel.start();
      expect(opened).toEqual(['org-a']);
    });

    it('does not reopen for the same organization', () => {
      const { opened, channel } = scoped();
      channel.setScope('org-a');
      channel.start();
      channel.setScope('org-a');
      expect(opened).toEqual(['org-a']);
    });

    it("tells the screens the last event is not this tenant's, and starts the cursor over", () => {
      const { streams, publish, channel } = scoped();
      channel.start();
      streams.get('home')!.emit(event(40));
      channel.setScope('org-b');
      // org-b's seq is its own: a low one is news there.
      streams.get('org-b')!.emit(event(3));
      expect(publish.mock.calls.map(([e]) => (e as StudioEvent | null)?.seq ?? null)).toEqual([40, null, 3]);
    });

    it('goes back to the home tenant when no organization is on screen', () => {
      const { opened, channel } = scoped();
      channel.setScope('org-a');
      channel.start();
      channel.setScope(null);
      expect(opened).toEqual(['org-a', null]);
      expect(channel.scope()).toBeNull();
    });
  });
});
