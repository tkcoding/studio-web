/**
 * Project › Releases' app: its API service (studio-environments,
 * studio-artifact-ingest, studio-tasks, account-management), the framework's
 * i18n and the shared query cache. No slices: the screen keeps what it read
 * in component state.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';
import { ReleasesApiService } from './api/ReleasesApiService';

apiRegistry.register(ReleasesApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
