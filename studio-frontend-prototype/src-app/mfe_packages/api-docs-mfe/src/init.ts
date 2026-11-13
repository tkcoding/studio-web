/**
 * The Docs & API kit's app: the framework's i18n, the shared query cache, and
 * the shared session (every MFE sends the person's bearer through it).
 */

import { createFrontX, apiRegistry, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';

apiRegistry.initialize();

const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
