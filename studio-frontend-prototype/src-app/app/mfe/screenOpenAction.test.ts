import { describe, expect, it, vi } from 'vitest';

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  eventBus: { emit },
}));

import { createScreenOpenHandler, routeOf, screenForRoute } from './screenOpenAction';
import type { StudioScreenExtension } from './screenLevels';

const screens = [
  { id: 'specs', presentation: { route: '/projects/specs', label: 'Specs', level: 'project', section: 'specs' } },
  { id: 'connections', presentation: { route: '/connections', label: 'Connections', level: 'organization' } },
] as unknown as StudioScreenExtension[];

describe('screen.open', () => {
  it('reads a route and nothing else', () => {
    expect(routeOf({ route: '/connections' })).toBe('/connections');
    expect(routeOf({ route: 'connections' })).toBeNull();
    expect(routeOf(undefined)).toBeNull();
  });

  it('finds the screen by its manifest route', () => {
    expect(screenForRoute(screens, '/projects/specs')?.id).toBe('specs');
    expect(screenForRoute(screens, '/nowhere')).toBeUndefined();
  });

  it('asks for the screen the way a tab click does, and ignores an unknown one', async () => {
    const handler = createScreenOpenHandler(() => screens);
    await handler.handleAction('t', { route: '/connections' });
    expect(emit).toHaveBeenCalledWith('app/context/screen/requested', { extensionId: 'connections' });
    emit.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler.handleAction('t', { route: '/nowhere' });
    expect(emit).not.toHaveBeenCalled();
  });
});
