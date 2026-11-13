import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { STUDIO_SHARED_PROPERTY_LIVE_EVENT } from '../host/hostProperties';
import { domainChanged, isRunEnding, isRunEvent, isStudioEvent, useStudioEventRefresh } from './liveEvents';
import type { StudioEvent } from './StudioEventsApiService';

function event(seq: number, subject_type = 'task_run'): StudioEvent {
  return { seq, at_ms: 1, kind: 'task.running', subject_type, subject_id: `r${seq}`, source: 'studio-tasks', payload: {} };
}

describe('isStudioEvent', () => {
  it('accepts a frame and refuses what is not one', () => {
    expect(isStudioEvent(event(1))).toBe(true);
    expect(isStudioEvent(null)).toBe(false);
    expect(isStudioEvent({ seq: '1', kind: 'x', subject_type: 'y', subject_id: 'z' })).toBe(false);
  });

  it("tells a run's ending from its progress", () => {
    const run = (state: string): StudioEvent => ({ ...event(1), payload: { run_id: 'r', state } });
    expect(isRunEnding(run('succeeded'))).toBe(true);
    expect(isRunEnding(run('failed'))).toBe(true);
    expect(isRunEnding(run('cancelled'))).toBe(true);
    expect(isRunEnding(run('running'))).toBe(false);
    expect(isRunEnding({ ...run('succeeded'), subject_type: 'workspace' })).toBe(false);
  });

  it('tells a run transition from anything else', () => {
    expect(isRunEvent(event(1))).toBe(true);
    expect(isRunEvent(event(1, 'workspace'))).toBe(false);
  });
});

describe('domainChanged', () => {
  const change = (kind: string, entity?: string): StudioEvent => ({
    ...event(1, 'domain'),
    kind,
    subject_id: 'fallback',
    payload: entity ? { entity } : {},
  });

  it('matches objects of the named types, by the payload or else the subject', () => {
    const matches = domainChanged(['environment', 'fallback']);
    expect(matches(change('domain.objects_changed', 'environment'))).toBe(true);
    expect(matches(change('domain.objects_changed', 'report'))).toBe(false);
    expect(matches(change('domain.objects_changed'))).toBe(true);
  });

  it('matches a model change only when asked to', () => {
    expect(domainChanged(['x'])(change('domain.model_changed'))).toBe(false);
    expect(domainChanged(['x'], { model: true })(change('domain.model_changed'))).toBe(true);
  });

  it('ignores a run transition', () => {
    expect(domainChanged(['task_run'])(event(1))).toBe(false);
  });
});

describe('useStudioEventRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function mount(initial: StudioEvent | null, matches = isRunEvent) {
    const fixture = createMfeBridgeFixture({
      domainId: 'screen',
      instanceId: 'inst',
      initialProperties: { [STUDIO_SHARED_PROPERTY_LIVE_EVENT]: initial as unknown as string },
    });
    const refresh = vi.fn();
    const Probe: React.FC = () => {
      useStudioEventRefresh(matches, refresh, { bridge: fixture.bridge });
      return null;
    };
    const view = render(<Probe />);
    const publish = (next: StudioEvent | null) =>
      act(() => fixture.setProperty(STUDIO_SHARED_PROPERTY_LIVE_EVENT, next as unknown as string));
    return { refresh, publish, view };
  }

  it('does not refresh for the event that was there before the screen mounted', () => {
    const { refresh } = mount(event(5));
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once for a burst, after the delay', () => {
    const { refresh, publish } = mount(null);
    publish(event(1));
    publish(event(2));
    publish(event(3));
    expect(refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('is not starved by a run that keeps reporting', () => {
    const { refresh, publish } = mount(null);
    for (let seq = 1; seq <= 10; seq += 1) {
      publish(event(seq));
      act(() => vi.advanceTimersByTime(100));
    }
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores what it was not asked about, and a replayed seq', () => {
    const { refresh, publish } = mount(event(4));
    publish(event(5, 'workspace'));
    publish(event(3));
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hears a new organization's events from its first seq, once the shell switched streams", () => {
    const { refresh, publish } = mount(event(40));
    // The shell's channel moved to another organization: null, then that
    // tenant's own sequence, which starts low.
    publish(null);
    publish(event(2));
    act(() => vi.advanceTimersByTime(300));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('drops a gathered refresh when the screen goes away', () => {
    const { refresh, publish, view } = mount(null);
    publish(event(1));
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
