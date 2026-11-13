import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { HelloStatus } from './HelloPanel';

const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

/** `./status`: the chip beside the open project (the shell's slot `project.header.status`). */
class StatusLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <HelloStatus bridge={bridge} />;
  }
}

export default new StatusLifecycle();
