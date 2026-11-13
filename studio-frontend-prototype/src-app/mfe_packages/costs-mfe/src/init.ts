/**
 * Organization › Costs' app: its API service, account-management (who "You"
 * is in the report by person), the framework's i18n and the shared query
 * cache. No slices: the screen keeps its working copies in component state.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, authShared } from '@constructor-studio/mfe-shared';
import { CostsApiService } from './api/CostsApiService';

apiRegistry.register(CostsApiService);
apiRegistry.register(AccountsApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
