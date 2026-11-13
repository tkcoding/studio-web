/**
 * Creating the connection: the only place in this MFE that writes.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-create-write:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-verify:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-announce:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-create-write:p2
// @cpt-flow:cpt-studiofrontend-flow-connection-create:p1
import {
  apiRegistry,
  eventBus,
  invalidateQueryCacheForApp,
  type AppDispatch,
  type FrontXApp,
} from '@gears-frontx/react';
import { ConnectorsApiService, refusalFrom } from '@constructor-studio/mfe-shared';
import { isDraftUsable, toCreateBody } from '../model/connectionDraft';
import { submitFailed, submitStarted, submitSucceeded } from '../slices/connectSlice';
import '../events/connectEvents';


export function initConnectEffects(dispatch: AppDispatch, app: FrontXApp): void {
  eventBus.on('mfe/connections/create-requested', ({ orgId, draft }) => {
    const connectors = apiRegistry.getService(ConnectorsApiService);

    // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-1
    if (!isDraftUsable(draft) || !orgId) return;
    // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-1

    dispatch(submitStarted());

    void (async () => {
      try {
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-4
        const created = await connectors.createConnection.fetch(toCreateBody(draft, orgId));
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-4
        dispatch(submitSucceeded());

        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-7
        void invalidateQueryCacheForApp(app, connectors.connections({ tenantId: orgId })).catch(
          (error: unknown) => {
            console.error('[connections] created, but the listing was not invalidated', error);
          }
        );

        eventBus.emit('mfe/connections/created', {
          id: created.connection.id,
          label: created.connection.label,
        });
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-7
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-5
        // @cpt-begin:cpt-studiofrontend-algo-connection-create-write:p2:inst-6
        dispatch(submitFailed(refusalFrom(error, 'error_generic')));
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-5
        // @cpt-end:cpt-studiofrontend-algo-connection-create-write:p2:inst-6
      }
    })();
  });
}
