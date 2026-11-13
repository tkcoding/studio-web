/**
 * This kit's translations, on the framework's own screen-level i18n with
 * English under every language (`loadScreenTranslations`). One dictionary per
 * part of the page, so each part keeps its own words: call sites write
 * `t('title')` while the registry is asked for `screen.product.<part>:title`.
 */

import { createScreenTranslations, type TranslationModules } from '@constructor-studio/mfe-shared';

const page = import.meta.glob('./screens/product/i18n/*.json') as TranslationModules;
const map = import.meta.glob('./screens/product/map/i18n/*.json') as TranslationModules;
const configurator = import.meta.glob('./screens/product/configurator/i18n/*.json') as TranslationModules;
const flow = import.meta.glob('./screens/product/flow/i18n/*.json') as TranslationModules;
const frontend = import.meta.glob('./screens/product/frontend/i18n/*.json') as TranslationModules;
const infra = import.meta.glob('./screens/product/infra/i18n/*.json') as TranslationModules;
const components = import.meta.glob('./screens/components/i18n/*.json') as TranslationModules;

/** The Product page: its header, section tabs, Infrastructure and Frontend sections. */
export const useProductTranslations = createScreenTranslations('product', 'main', page, './screens/product/i18n');
/** The product map and product.gdl. */
export const useMapTranslations = createScreenTranslations('product', 'map', map, './screens/product/map/i18n');
/** The configurator: picking gears, a gear's config. */
export const useConfiguratorTranslations = createScreenTranslations(
  'product',
  'configurator',
  configurator,
  './screens/product/configurator/i18n'
);
/** The strip from configured to running, and what the product is. */
export const useFlowTranslations = createScreenTranslations('product', 'flow', flow, './screens/product/flow/i18n');
/** The frontend constructor. */
export const useFrontendTranslations = createScreenTranslations(
  'product',
  'frontend',
  frontend,
  './screens/product/frontend/i18n'
);
/** The Infrastructure section: infra services, their placement and plans. */
export const useInfraTranslations = createScreenTranslations('product', 'infra', infra, './screens/product/infra/i18n');
/** Project › Components: the inventory. */
export const useComponentsTranslations = createScreenTranslations(
  'product',
  'components',
  components,
  './screens/components/i18n'
);
