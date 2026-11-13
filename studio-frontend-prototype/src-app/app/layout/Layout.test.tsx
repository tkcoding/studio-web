import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { noOrganization } = vi.hoisted(() => ({ noOrganization: { value: false } }));

vi.mock('@/app/actions/bootstrapActions', () => ({
  fetchCurrentUser: vi.fn(),
  fetchAppContext: vi.fn(),
}));
vi.mock('@/app/live/useLiveChannel', () => ({
  useLiveChannelOpen: () => undefined,
  useLiveChannelFollowsOrganization: () => undefined,
}));
vi.mock('./AvailableScreens', () => ({ AvailableScreens: () => null }));
vi.mock('./Header', () => ({ Header: () => <div data-testid="top-bar" /> }));
vi.mock('./LevelTabs', () => ({ LevelTabs: () => <div data-testid="level-tabs" /> }));
vi.mock('./RuntimeKits', () => ({ RuntimeKits: () => <div data-testid="runtime-kits" /> }));
vi.mock('./KitDock', () => ({ KitDock: () => <div data-testid="kit-dock" /> }));
vi.mock('./Popup', () => ({ Popup: () => null }));
vi.mock('./Overlay', () => ({ Overlay: () => null }));
vi.mock('./OverlayDialog', () => ({ OverlayDialog: () => null }));
vi.mock('./Presence', () => ({ Presence: () => <div data-testid="presence" /> }));
vi.mock('./OrganizationAccessGate', () => ({
  OrganizationAccessGate: () => <div data-testid="access-gate" />,
  useHasNoOrganization: () => noOrganization.value,
}));

import { Layout } from './Layout';

const renderLayout = () =>
  render(
    <Layout>
      <div data-testid="mounted-screen" />
    </Layout>
  );

describe('Layout', () => {
  afterEach(() => {
    cleanup();
    noOrganization.value = false;
  });

  it("draws the level's tabs between the top bar and the screen (the name is in the path)", () => {
    renderLayout();
    expect(screen.getByTestId('top-bar')).toBeTruthy();
    expect(screen.getByTestId('level-tabs')).toBeTruthy();
    expect(screen.getByTestId('mounted-screen')).toBeTruthy();
    // Signed in means reporting in: the heartbeat and the notes left for this person.
    expect(screen.getByTestId('presence')).toBeTruthy();
  });

  it("puts the kits' dock beside the screen, in the same row", () => {
    renderLayout();
    const dock = screen.getByTestId('kit-dock');
    expect(dock.parentElement).toBe(screen.getByTestId('mounted-screen').closest('main')?.parentElement);
  });

  // Onboarding: there is no level to name and no section to offer.
  it('draws neither for a person with no organization, who gets the gate instead', () => {
    noOrganization.value = true;
    renderLayout();
    expect(screen.getByTestId('top-bar')).toBeTruthy();
    expect(screen.queryByTestId('level-tabs')).toBeNull();
    expect(screen.queryByTestId('mounted-screen')).toBeNull();
    expect(screen.queryByTestId('kit-dock')).toBeNull();
    expect(screen.getByTestId('access-gate')).toBeTruthy();
  });
});
