/**
 * Organization › Infrastructure's app: its API service (studio-environments,
 * studio-connector, account-management's users), account-management for the
 * organization's workspaces and projects, the framework's i18n and the shared
 * query cache. No slices: the screen keeps its working copies in component state.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, authShared } from '@constructor-studio/mfe-shared';
import { InfrastructureApiService } from './api/InfrastructureApiService';

apiRegistry.register(InfrastructureApiService);
apiRegistry.register(AccountsApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
