/**
 * The second entry of this MFE: Organization › Constructor Research, the
 * Constructor Research kit's screen (`constructor-research`, docs/design/studio-kits.md
 * §3.13). Its own entry, not a section of Infrastructure's: the shell shows it
 * only where the organization installed that kit, and one lifecycle singleton
 * holds one root.
 */

import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, OrganizationProvider, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { ResearchScreen } from './screens/research/ResearchScreen';

const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class ResearchLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    // The organization in scope is the shell's shared property; the bridge
    // opens Connections (the member's sign-in) and Infrastructure.
    return (
      <OrganizationProvider>
        <ResearchScreen bridge={bridge} />
      </OrganizationProvider>
    );
  }
}

export default new ResearchLifecycle();
