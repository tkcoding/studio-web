import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { HelloScreen } from './HelloScreen';

/** The ui-kit theme travels inside the bundle, re-anchored on the shadow host. */
const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class HelloLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <HelloScreen bridge={bridge} />;
  }
}

/** Module Federation expects a default export with mount and unmount. */
export default new HelloLifecycle();
