// @cpt-flow:cpt-frontx-flow-request-lifecycle-query-client-lifecycle:p2

/** MFE Screen Container Component. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useFrontX,
  eventBus,
  ExtensionDomainSlot,
  screenDomain,
} from '@gears-frontx/react';
import { bootstrapMFE } from './bootstrap';
import { EditorSessionStatus } from './EditorSessionStatus';
import { UnresolvedScreen } from '@/app/layout/UnresolvedScreen';
import { KitAbsentScreen } from '@/app/layout/KitAbsentScreen';
import { KitSlot } from '@/app/layout/KitSlot';
import { SHELL_SLOTS } from './slots';
import { EditorBar } from './EditorBar';
import type { MfeBootstrapStatus } from '@/app/slices/mfeBootstrapSlice';

export function MfeScreenContainer() {
  const app = useFrontX();
  const bootstrappedRef = useRef(false);
  const [status, setStatus] = useState<MfeBootstrapStatus>('pending');

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    bootstrapMFE(app).then(() => {
      setStatus('ready');
      eventBus.emit('app/mfe/bootstrap', { status: 'ready' });
    }).catch((error) => {
      console.error('[MFE Bootstrap] Failed to bootstrap MFE:', error);
      setStatus('failed');
      eventBus.emit('app/mfe/bootstrap', { status: 'failed' });
    });
  }, [app]);
  const startRouting = useCallback(() => {
    if (!app.mfeRegistry) return;
    // Which screen opens is the address's to say, and the effects that
    // start the router decide it (ADR-0028). Emitted on every attach: the
    // second time only re-applies what the address already says.
    eventBus.emit('app/routing/start');
  }, [app.mfeRegistry]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-auto" data-mfe-screen-container>
      {status === 'failed' ? (
        <div className="p-6 text-label text-muted-foreground" role="alert" data-mfe-bootstrap-failed>
          Screens could not be loaded. Check the console for the manifest error.
        </div>
      ) : status === 'ready' && app.mfeRegistry ? (
        <>
          {/* Kits' panels for the screen on display (slot screen.panels), e.g. on Project › Overview. */}
          <KitSlot slot={SHELL_SLOTS.screenPanels} direction="column" className="shrink-0 px-6 pt-4" />
          {/* Over the editor only: Reload, Stop, the desktop hand-off. */}
          <EditorBar />
          <div className="relative min-h-0 flex-1">
            <ExtensionDomainSlot
              registry={app.mfeRegistry}
              domainId={screenDomain.id}
              className="h-full"
              onAttached={startRouting}
            />
            <EditorSessionStatus />
            <UnresolvedScreen registry={app.mfeRegistry} />
            {/* A kit's screen reached where its kit is not installed (an old link, a pin). */}
            <KitAbsentScreen />
          </div>
        </>
      ) : null}
    </div>
  );
}
