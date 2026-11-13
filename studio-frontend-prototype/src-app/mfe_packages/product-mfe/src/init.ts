/**
 * The Product kit's app: its API service, the framework's i18n and the shared
 * query cache. No slices — each screen reads and draws; what it keeps is its own.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';
import { ProductApiService } from './api/ProductApiService';

apiRegistry.register(ProductApiService);
apiRegistry.initialize();

// authShared(): the host's auth plugin lives in the host's realm, so without it
// every read goes out with no bearer and answers 401.
const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
