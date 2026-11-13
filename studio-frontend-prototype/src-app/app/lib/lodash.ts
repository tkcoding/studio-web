/**
 * What the host bundle takes from `lodash`, one function at a time.
 *
 * `lodash` is CommonJS, so `import { clamp } from 'lodash'` cannot be
 * tree-shaken: `@gears-frontx/studio` imports two functions that way and the
 * whole library (~550 KB before minification) landed in the host's entry
 * chunk. `vite.config.ts` aliases the bare `lodash` specifier here, and each
 * function comes from its own per-method module.
 *
 * A new `lodash` import elsewhere that names a function missing here fails the
 * build ("is not exported"), never the page: add the function to this list.
 */

export { default as clamp } from 'lodash/clamp';
export { default as upperFirst } from 'lodash/upperFirst';
