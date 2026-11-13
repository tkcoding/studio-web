/**
 * The Components kit's app: its API service, the accounts service (who the
 * caller is: a platform administrator's home is the platform root), the
 * framework's i18n and the shared query cache. No slices — the screens read
 * and draw.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, authShared } from '@constructor-studio/mfe-shared';
import { ComponentsApiService } from './api/ComponentsApiService';

apiRegistry.register(ComponentsApiService);
apiRegistry.register(AccountsApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
