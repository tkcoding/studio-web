/** The organization level's screens, in one entry. */

// @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-level:p1
import React from 'react';
import { useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import {
  OrganizationProvider,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
} from '@constructor-studio/mfe-shared';
import { WorkspacesScreen } from './screens/workspaces/WorkspacesScreen';
import { OverviewScreen } from './screens/overview/OverviewScreen';
import { BackgroundScreen } from './screens/background/BackgroundScreen';
import { InboxScreen } from './screens/inbox/InboxScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';

export interface OrganizationRootProps {
  bridge: ChildMfeBridge;
}

function screenOf(section: unknown): React.ReactNode {
  if (section === 'workspaces') return <WorkspacesScreen />;
  if (section === 'settings') return <SettingsScreen />;
  if (section === 'inbox') return <InboxScreen />;
  return <OverviewScreen />;
}

export const OrganizationRoot: React.FC<OrganizationRootProps> = () => {
  const section = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_SECTION);

  // The overview is the level's entry point (ADR-0069 parity), and what a
  // section this root does not know falls back to.
  if (section === 'tasks') return <BackgroundScreen />;
  return <OrganizationProvider>{screenOf(section)}</OrganizationProvider>;
};

OrganizationRoot.displayName = 'OrganizationRoot';
