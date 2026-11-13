/**
 * The Components kit (ADR-0068 §7), the prototype's Components area carried
 * over (ADR-0069 §5): one entry, four extensions, switched on the extension
 * the shell mounted —
 *
 * - Platform › Components: the common set every organization builds on
 *   (ADR-0042), the platform tier of the catalogue;
 * - Platform › Repositories: what the platform's catalogue reads;
 * - Platform › Publication requests: what organizations ask the platform to
 *   take, answered by a curator;
 * - Organization › Components: the registry — what the organization's
 *   projects declare, beside what its catalogue holds (ADR-0041).
 *
 * A component's page opens over the list on both Components screens.
 */

import React, { useMemo } from 'react';
import { useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import { Skeleton } from '@gears-frontx/ui-kit';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  useHostChrome,
  useOrganization,
} from '@constructor-studio/mfe-shared';
import { useComponentsTranslations } from '../../i18n';
import { ScopeContext, usePlatformAdmin, type Scope } from './common';
import { Catalogue } from './Catalogue';
import { PlatformRepositories } from './PlatformRepositories';
import { PublicationRequests } from './PublicationRequests';
import styles from './ComponentsScreen.module.css';

export type ComponentsView = 'platform' | 'organization' | 'repositories' | 'publications';

/** Which of the kit's screens the shell mounted, by its extension id. */
export function scopeOf(extensionId: string | undefined): ComponentsView {
  if (extensionId?.endsWith('.screens.organization.v1')) return 'organization';
  if (extensionId?.endsWith('.screens.repositories.v1')) return 'repositories';
  if (extensionId?.endsWith('.screens.publications.v1')) return 'publications';
  return 'platform';
}

/** The three platform extensions share one entry, so the shell names the open
 *  one by its `section` token; the extension id answers where no section is
 *  published (the organization's tab, an older shell). */
export function viewOf(extensionId: string | undefined, section: unknown): ComponentsView {
  if (section === 'catalogue') return 'platform';
  if (section === 'repositories' || section === 'publications') return section;
  return scopeOf(extensionId);
}

export const ComponentsScreen: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const section = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_SECTION);
  const view = viewOf(bridge.extensionId, section);
  const { org, loading: orgLoading } = useOrganization();
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useComponentsTranslations();
  const platformAdmin = usePlatformAdmin();
  const scope: Scope = useMemo(
    () => ({ org, platformAdmin, t, language, bridge, container: containerRef }),
    [org, platformAdmin, t, language, bridge, containerRef]
  );

  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme} data-components-view={view}>
      {loading || orgLoading ? (
        <Skeleton className={styles.skeleton} />
      ) : view === 'organization' && !org ? (
        <p className={styles.muted}>{t('no_org')}</p>
      ) : (
        <ScopeContext.Provider value={scope}>
          {view === 'publications' ? (
            <PublicationRequests />
          ) : view === 'repositories' ? (
            <PlatformRepositories />
          ) : (
            // Keyed by the organization: another organization is another read, from nothing.
            <Catalogue key={`${view}:${org?.id ?? ''}`} tier={view === 'platform' ? 'platform' : 'organization'} />
          )}
        </ScopeContext.Provider>
      )}
    </div>
  );
};

ComponentsScreen.displayName = 'ComponentsScreen';
