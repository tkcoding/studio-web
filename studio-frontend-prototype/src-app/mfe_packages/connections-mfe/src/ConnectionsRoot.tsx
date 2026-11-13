import React from 'react';
import { OrganizationProvider, useHostChrome } from '@constructor-studio/mfe-shared';
import { ConnectionListScreen } from './screens/connection-list/ConnectionListScreen';
import styles from './ConnectionsRoot.module.css';

/**
 * The bridge is not threaded through here any more: `MfeProvider` sits above
 * this root (mounted by `ThemeAwareReactLifecycle`), so anything that needs it
 * reads `useMfeBridge()` where it is used.
 */
export const ConnectionsRoot: React.FC = () => {
  const { containerRef, dataTheme } = useHostChrome();

  return (
    <div ref={containerRef} className={styles.root} data-theme={dataTheme}>
      <OrganizationProvider>
        <ConnectionListScreen />
      </OrganizationProvider>
    </div>
  );
};

ConnectionsRoot.displayName = 'ConnectionsRoot';
