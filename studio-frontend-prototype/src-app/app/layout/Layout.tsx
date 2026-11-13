/**
 * Layout Component
 *
 * Main layout orchestrator for the application.
 */

import React, { useEffect } from 'react';
import { fetchCurrentUser, fetchAppContext } from '@/app/actions/bootstrapActions';
import { Header } from './Header';
import { LevelTabs } from './LevelTabs';
import { RuntimeKits } from './RuntimeKits';
import { AvailableScreens } from './AvailableScreens';
import { Screen } from './Screen';
import { KitDock } from './KitDock';
import { Popup } from './Popup';
import { Overlay } from './Overlay';
import { OverlayDialog } from './OverlayDialog';
import { OrganizationAccessGate, useHasNoOrganization } from './OrganizationAccessGate';
import { useLiveChannelFollowsOrganization, useLiveChannelOpen } from '@/app/live/useLiveChannel';
import { Presence } from './Presence';

export interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  // An authenticated person with no organization membership gets the onboarding
  // state instead of the mounted screen (ADR-0011 §3). The top bar stays — they
  // still need the account menu and a way to sign out — but its context slot has
  // nothing to offer and the screen below has no scope to render in.
  const noOrganization = useHasNoOrganization();
  // The Layout is mounted only behind the AuthGate: the live channel is open
  // exactly while somebody is signed in (app/live/liveChannel.ts).
  useLiveChannelOpen();
  // …listening to the organization on screen, not only the person's home tenant.
  useLiveChannelFollowsOrganization();

  useEffect(() => {
    fetchCurrentUser();
    fetchAppContext();
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Global top bar: brand, the path to the level in scope, session */}
      <Header />

      {/* The level's tabs, then the screen they mount. Its name is in the path
          (ContextChain), the prototype's way (ADR-0069). */}
      {!noOrganization && <LevelTabs />}
      {/* Kits' screens loaded at run time, and a tile for any that did not come up. */}
      {!noOrganization && <RuntimeKits />}
      {/* Which screens a row inside a screen may lead to (kits installed here). */}
      {!noOrganization && <AvailableScreens />}
      {/* The screen, and beside it what a kit docks there (Studio AI). */}
      <div className="flex min-h-0 flex-1">
        <Screen>{noOrganization ? <OrganizationAccessGate /> : children}</Screen>
        {!noOrganization && <KitDock />}
      </div>

      {/* Out of the flow, over everything: dialogs and overlays. */}
      <OverlayDialog />
      <Popup />
      <Overlay />
      {/* The heartbeat that puts this person in Admin › System's list, and the notes left for them. */}
      <Presence />
    </div>
  );
};

Layout.displayName = 'Layout';
