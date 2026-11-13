/**
 * The Product kit (ADR-0068 §7), the prototype's Product and Components
 * project tabs carried over (ADR-0069 §5): one entry, two extensions, switched
 * on the `section` the shell publishes for the mounted one —
 *
 * - Project › Product (`product`): the one product the project ships, its
 *   map, configurator, strip from configured to running, infrastructure and
 *   frontend (`product-sections-view.tsx`);
 * - Project › Components (`components`): what the project is made of, the
 *   inventory (`project-components-view.tsx`).
 */

import React, { useMemo } from 'react';
import { useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import { Skeleton } from '@gears-frontx/ui-kit';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  useHostChrome,
} from '@constructor-studio/mfe-shared';
import { setOrganization } from './api/ProductApiService';
import { useProductTranslations } from './i18n';
import { ScopeContext, type Scope } from './screens/common';
import { ProductPage } from './screens/product/ProductPage';
import { ProjectComponentsInventory } from './screens/components/ProjectComponentsInventory';
import styles from './screens/product.module.css';

export type ProductView = 'product' | 'components';

/** Which of the kit's screens the shell mounted: by its section, else by its extension id. */
export function viewOf(extensionId: string | undefined, section: unknown): ProductView {
  if (section === 'components' || section === 'product') return section;
  return extensionId?.endsWith('.screens.components.v1') ? 'components' : 'product';
}

const idOf = (v: unknown): string | null =>
  typeof v === 'string' && v
    ? v
    : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' && (v as { id: string }).id
      ? (v as { id: string }).id
      : null;

export const ProductRoot: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const section = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_SECTION);
  const projectId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT));
  const workspaceId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE));
  const orgId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION));
  const view = viewOf(bridge.extensionId, section);
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useProductTranslations();

  // The catalogue, product and spec routes name the organization on screen.
  // Set while rendering, not in an effect: the screens' own effects run first
  // and read with it.
  setOrganization(orgId);

  const scope: Scope | null = useMemo(
    () => (projectId ? { projectId, workspaceId, orgId, language, bridge, container: containerRef } : null),
    [projectId, workspaceId, orgId, language, bridge, containerRef]
  );

  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-product-view={view}>
      {loading ? (
        <Skeleton className={styles.skeleton} />
      ) : !scope ? (
        <p className={styles.muted}>{t('no_project')}</p>
      ) : (
        <ScopeContext.Provider value={scope}>
          {/* Keyed by the scope: another project is another read, from nothing. */}
          {view === 'components' ? (
            <ProjectComponentsInventory key={`${projectId}:${orgId ?? ''}`} />
          ) : (
            <ProductPage key={`${projectId}:${orgId ?? ''}`} />
          )}
        </ScopeContext.Provider>
      )}
    </div>
  );
};

ProductRoot.displayName = 'ProductRoot';
