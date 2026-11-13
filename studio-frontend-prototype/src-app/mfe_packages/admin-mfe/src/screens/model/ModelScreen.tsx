/**
 * The shell's generic screens for the three levels (ADR-0066, the prototype's
 * `level-tabs-ui.tsx` and `object-attributes.tsx`): on an organization, a
 * workspace or a project, the **Attributes** tab — what the Studio domain
 * model records about that tenant — and every tab the model adds with a
 * `shows` relation no other screen answers (section `type:<name>`), which
 * lists the objects of the type the relation reaches.
 *
 * One entry with the rest of Admin; the extension the shell mounted says which
 * level this is (`model_<level>` in its id), the section which tab.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRegistry, useSharedProperty } from '@gears-frontx/react';
import {
  DomainModelApiService,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  domainChanged,
  genericTabName,
  modelOf,
  useOrganization,
  useStudioEventRefresh,
  type DomainModel,
  type TabLevel,
} from '@constructor-studio/mfe-shared';
import { ErrorLine, errText, useAdmin } from '../admin/common';
import { ObjectAttributes } from './ObjectAttributes';
import { TypeObjects } from './TypeObjects';
import styles from '../admin/Admin.module.css';

/** The level a generic screen extension stands for, from its id; null for any other screen. */
export function modelLevelOf(extensionId: string | undefined | null): TabLevel | null {
  const m = /\.model_(organization|workspace|project)(?:_types)?\.v1$/.exec(extensionId ?? '');
  return m ? (m[1] as TabLevel) : null;
}

export interface ModelRead {
  model: DomainModel | null;
  error: string | null;
  /** Reads it again, after an edit made here. */
  reload: () => void;
}

/** The organization's model, read again when it changes. */
export function useModel(orgId: string): ModelRead {
  const [read, setRead] = useState<{ orgId: string; model: DomainModel | null; error: string | null }>({
    orgId: '',
    model: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const again = useCallback(() => setTick((n) => n + 1), []);
  useStudioEventRefresh(domainChanged([], { model: true }), again);
  useEffect(() => {
    let live = true;
    apiRegistry
      .getService(DomainModelApiService)
      .types({ orgId })
      .fetch({ staleTime: 0 })
      .then(
        (res) => live && setRead({ orgId, model: modelOf(res), error: null }),
        (e: unknown) => live && setRead({ orgId, model: null, error: errText(e) })
      );
    return () => {
      live = false;
    };
  }, [orgId, tick]);
  return read.orgId === orgId
    ? { model: read.model, error: read.error, reload: again }
    : { model: null, error: null, reload: again };
}

const isRef = (v: unknown): v is { id: string; name: string } =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string';

export function ModelScreen({ level, section }: { level: TabLevel; section: string | null }) {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  const workspace = useSharedProperty<unknown>(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE);
  const project = useSharedProperty<unknown>(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('no_org')}</p>;

  // The tenant the level is, and its name when the shell says it.
  const tenant =
    level === 'organization'
      ? { id: org.id, name: org.name }
      : level === 'workspace'
        ? isRef(workspace)
          ? workspace
          : null
        : typeof project === 'string' && project
          ? { id: project, name: '' }
          : null;
  if (!tenant) return <p className={styles.muted}>{t('model_no_place')}</p>;
  return <Screen key={`${org.id}:${tenant.id}`} orgId={org.id} level={level} tenant={tenant} section={section} />;
}

function Screen({
  orgId,
  level,
  tenant,
  section,
}: {
  orgId: string;
  level: TabLevel;
  tenant: { id: string; name: string };
  section: string | null;
}) {
  const { t } = useAdmin();
  const { model, error, reload } = useModel(orgId);
  if (error) return <ErrorLine>{t('model_unreadable', { error })}</ErrorLine>;
  if (!model) return <p className={styles.muted}>{t('reading')}</p>;
  const tab = genericTabName(section);
  if (tab !== null) {
    return (
      <TypeObjects
        key={tab}
        orgId={orgId}
        model={model}
        level={level}
        tabName={tab}
        // The organization's objects are every scope's; below it, the place's own.
        scope={level === 'organization' ? null : tenant.id}
      />
    );
  }
  return <ObjectAttributes orgId={orgId} model={model} level={level} tenant={tenant} onModelChanged={reload} />;
}
