/**
 * The Project domain model kit (ADR-0068 §7): the prototype's Project domain model
 * tab carried over (ADR-0069 §5). Reads the project, its workspace and
 * organization from the shell's shared properties and keys the screen by
 * them: another project is another read, from nothing.
 */

import React, { useMemo } from 'react';
import { useSharedProperty, type ChildMfeBridge } from '@gears-frontx/react';
import { Skeleton } from '@gears-frontx/ui-kit';
import {
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  useHostChrome,
} from '@constructor-studio/mfe-shared';
import { setOrganization } from './api/DomainModelApiService';
import { useDomainTranslations } from './i18n';
import { ScopeContext, type Scope } from './screens/common/ui';
import { DomainModelScreen } from './screens/domain/DomainModelScreen';
import styles from './screens/common/common.module.css';

const idOf = (v: unknown): string | null =>
  typeof v === 'string' && v
    ? v
    : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' && (v as { id: string }).id
      ? (v as { id: string }).id
      : null;

export const DomainModelRoot: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const projectId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT));
  const workspaceId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE));
  const orgId = idOf(useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION));
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useDomainTranslations();

  // The spec-mapping and product routes name the organization on screen.
  // Set while rendering, not in an effect: the screen's own effects run first.
  setOrganization(orgId);

  const scope: Scope | null = useMemo(
    () => (projectId ? { projectId, workspaceId, orgId, language, bridge, container: containerRef } : null),
    [projectId, workspaceId, orgId, language, bridge, containerRef]
  );

  return (
    <div ref={containerRef} className={styles.screen} data-theme={dataTheme}>
      {loading ? (
        <Skeleton className={styles.skeleton} />
      ) : !scope ? (
        <p className={styles.muted}>{t('no_project')}</p>
      ) : (
        <ScopeContext.Provider value={scope}>
          <DomainModelScreen key={`${projectId}:${orgId ?? ''}`} />
        </ScopeContext.Provider>
      )}
    </div>
  );
};

DomainModelRoot.displayName = 'DomainModelRoot';
