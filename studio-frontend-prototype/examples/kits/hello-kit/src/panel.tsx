import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { HelloPanel } from './HelloPanel';

const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

/** `./panel`: the panel on Project › Overview (the shell's slot `screen.panels`). */
class PanelLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <HelloPanel bridge={bridge} />;
  }
}

export default new PanelLifecycle();
