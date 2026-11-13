/**
 * The Assistant kit's app: the framework's i18n, the shared query cache, and
 * the shared session (the panel's reads go out with the person's bearer).
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';

apiRegistry.initialize();

const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
