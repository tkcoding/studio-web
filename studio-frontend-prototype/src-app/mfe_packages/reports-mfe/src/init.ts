/**
 * Organization › Reports' app: its API service (studio-reports, the refresh's
 * run, the members that name the plan's people), studio-connector (the GitHub
 * connections a source reads through), account-management (the organization's
 * workspaces a plan's consumer can be), the framework's i18n and the shared
 * query cache. No slices: the screen keeps its working copies in component
 * state.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, ConnectorsApiService, authShared } from '@constructor-studio/mfe-shared';
import { ReportsApiService } from './api/ReportsApiService';

apiRegistry.register(ReportsApiService);
apiRegistry.register(ConnectorsApiService);
apiRegistry.register(AccountsApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
