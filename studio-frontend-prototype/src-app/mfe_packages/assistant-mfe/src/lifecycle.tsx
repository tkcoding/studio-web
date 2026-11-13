import React from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { anchorKitThemeOnShadowHost, StudioMfeLifecycle } from '@constructor-studio/mfe-shared';
import kitTheme from '@gears-frontx/ui-kit/theme.css?inline';
import { mfeApp } from './init';
import { AssistantPanel } from './screens/panel/AssistantPanel';

/** The ui-kit theme, re-anchored `:root`→`:host` once at module load (see api-docs-mfe). */
const KIT_THEME_ON_HOST = anchorKitThemeOnShadowHost(kitTheme);

class AssistantLifecycle extends StudioMfeLifecycle {
  constructor() {
    super(mfeApp, KIT_THEME_ON_HOST);
  }

  protected renderContent(bridge: ChildMfeBridge): React.ReactNode {
    return <AssistantPanel bridge={bridge} />;
  }
}

/** Module Federation expects a default export with mount/unmount. */
export default new AssistantLifecycle();
