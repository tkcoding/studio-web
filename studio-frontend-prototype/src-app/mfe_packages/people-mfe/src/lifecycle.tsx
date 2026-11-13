import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { PeopleScreen } from './screens/people/PeopleScreen';

/**
 * The ui-kit theme travels inside this bundle (`?inline`; the kit is
 * deliberately absent from sharedDeps — externalizing it would strand its CSS)
 * and is re-anchored `:root`→`:host`, because a ShadowRoot is a
 * DocumentFragment that `:root` can never reach.
 */
const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class ScreensetLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <PeopleScreen bridge={bridge} />;
  }
}

/** Module Federation expects a default export with mount/unmount. */
export default new ScreensetLifecycle();
