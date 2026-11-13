import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE } from './hostProperties';
import {
  isAvailableScreens,
  kitAvailable,
  routeAvailable,
  useScreenAvailability,
  type AvailableScreens,
  type ScreenAvailability,
} from './screens';

const known: AvailableScreens = { routes: ['/organization/overview', '/issues'], kits: ['project-issues'] };

describe('routeAvailable / kitAvailable', () => {
  it('offers a route the shell lists and refuses one it does not', () => {
    expect(routeAvailable(known, '/issues')).toBe(true);
    expect(routeAvailable(known, '/releases')).toBe(false);
    expect(routeAvailable(known, null)).toBe(false);
  });

  it('counts everything as available before the shell knows', () => {
    expect(routeAvailable(null, '/releases')).toBe(true);
    expect(kitAvailable(null, 'product-releases')).toBe(true);
    expect(kitAvailable({ routes: [], kits: null }, 'product-releases')).toBe(true);
  });

  it("knows an installed kit from one that is not, and an item with no kit is the shell's", () => {
    expect(kitAvailable(known, 'project-issues')).toBe(true);
    expect(kitAvailable(known, 'project-lifecycle')).toBe(false);
    expect(kitAvailable(known, null)).toBe(true);
  });

  it('accepts only the shape the shell publishes', () => {
    expect(isAvailableScreens(known)).toBe(true);
    expect(isAvailableScreens({ routes: [], kits: null })).toBe(true);
    expect(isAvailableScreens({ routes: '/x', kits: null })).toBe(false);
    expect(isAvailableScreens(null)).toBe(false);
  });
});

describe('useScreenAvailability', () => {
  it('follows what the shell publishes', () => {
    const fixture = createMfeBridgeFixture({
      domainId: 'screen',
      instanceId: 'inst',
      initialProperties: { [STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE]: null as unknown as string },
    });
    let seen: ScreenAvailability | null = null;
    const Probe: React.FC = () => {
      seen = useScreenAvailability({ bridge: fixture.bridge });
      return null;
    };
    render(<Probe />);
    expect(seen!.route('/releases')).toBe(true);
    act(() => fixture.setProperty(STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE, known as unknown as string));
    expect(seen!.route('/releases')).toBe(false);
    expect(seen!.route('/issues')).toBe(true);
    expect(seen!.kit('project-lifecycle')).toBe(false);
  });
});
