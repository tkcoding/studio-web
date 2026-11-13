/**
 * The Issues kit's app: its API service, the framework's i18n and the shared
 * query cache. No slices — the screen reads and draws, it keeps no state of
 * its own worth a store.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';
import { IssuesApiService } from './api/IssuesApiService';

apiRegistry.register(IssuesApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
