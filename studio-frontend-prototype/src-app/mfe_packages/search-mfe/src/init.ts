/**
 * Search's app: the framework's i18n, the shared query cache, the shared
 * session, and the two services it reads — the organization's workspaces and
 * projects (account management) and the artifact graph's search.
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { AccountsApiService, authShared } from '@constructor-studio/mfe-shared';
import { SearchApiService } from './api/SearchApiService';

apiRegistry.register(AccountsApiService);
apiRegistry.register(SearchApiService);
apiRegistry.initialize();

const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
