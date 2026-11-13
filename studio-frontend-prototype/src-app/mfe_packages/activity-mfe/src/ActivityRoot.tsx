/**
 * The Activity kit's two project sections in one entry: Activity, and the
 * Timeline (ADR-0066), which shows project-lifecycle's milestones
 * (ADR-0070 §2). The shell relays which one through the section property.
 */

import React from 'react';
import { useSharedProperty } from '@gears-frontx/react';
import {
  OrganizationProvider,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  useHostChrome,
} from '@constructor-studio/mfe-shared';
import { Skeleton } from '@gears-frontx/ui-kit';
import { useActivityTranslations } from './i18n';
import { ActivityScreen } from './screens/activity/ActivityScreen';
import { TimelineScreen } from './screens/timeline/TimelineScreen';
import styles from './screens/Screen.module.css';

export const ActivityRoot: React.FC = () => {
  const section = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_SECTION);
  const project = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  const projectId = typeof project === 'string' && project ? project : null;
  const { containerRef, dataTheme, language } = useHostChrome();
  const { t, loading } = useActivityTranslations();

  const body = () => {
    if (loading) return <Skeleton className={styles.skeleton} />;
    if (!projectId) return <p className={styles.muted}>{t('no_project')}</p>;
    // Keyed by the project: another project is another read, from nothing.
    return section === 'timeline' ? (
      <TimelineScreen key={projectId} projectId={projectId} t={t} container={containerRef} />
    ) : (
      <ActivityScreen key={projectId} projectId={projectId} t={t} language={language} />
    );
  };

  return (
    <OrganizationProvider>
      <div ref={containerRef} className={styles.screen} data-theme={dataTheme}>
        {body()}
      </div>
    </OrganizationProvider>
  );
};

ActivityRoot.displayName = 'ActivityRoot';
