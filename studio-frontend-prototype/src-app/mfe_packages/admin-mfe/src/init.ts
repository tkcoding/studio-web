/**
 * Admin's app: its API service, the accounts reads it shares with the other
 * MFEs, the framework's i18n and the shared query cache. No slices — each
 * section reads and writes what it shows and keeps nothing worth a store.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, DomainModelApiService, authShared } from '@constructor-studio/mfe-shared';
import { AdminApiService } from './api/AdminApiService';

apiRegistry.register(AdminApiService);
apiRegistry.register(AccountsApiService);
// The generic screens of the three levels: a type's objects and a tenant's attributes (ADR-0066).
apiRegistry.register(DomainModelApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
