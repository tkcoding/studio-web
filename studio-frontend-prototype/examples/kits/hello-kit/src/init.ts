/**
 * The demo kit's app. It makes no requests, but a kit that does needs
 * `authShared()`: the host's auth lives in the host's realm, and without it
 * every request goes out with no bearer.
 */

import { createFrontX, i18n, queryCacheShared } from '@gears-frontx/react';
import { authShared } from '@constructor-studio/mfe-shared';

const mfeApp = createFrontX().use(i18n()).use(queryCacheShared()).use(authShared()).build();

export { mfeApp };
