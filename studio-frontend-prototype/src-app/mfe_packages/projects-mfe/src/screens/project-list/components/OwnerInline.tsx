import React from 'react';
import { Skeleton } from '@gears-frontx/ui-kit';
import { displayName } from '../../../model/project';
import { useOrganization } from '@constructor-studio/mfe-shared';
import { useUserById } from '../../../shared/users';
import type { ProjectConfigState } from '../../../shared/useProjectConfig';
import { useProjectListText } from '../../../i18n';
import { LoadFailed } from './LoadFailed';
import { NoData } from './NoData';
import styles from '../ProjectListScreen.module.css';

/**
 * The project's owner: `owner_id` from its own metadata, named by one
 * point-lookup per distinct owner (`useUserById`).
 */
export const OwnerInline: React.FC<{ state: ProjectConfigState }> = ({ state }) => {
  const t = useProjectListText();
  const { org, loading: orgLoading } = useOrganization();
  if (state.loading || orgLoading) return <Skeleton className={styles.cellSkeleton} />;
  if (state.failed) return <LoadFailed label={t('load_failed')} />;
  const ownerId = state.config?.owner_id;
  if (!ownerId || !org) return <NoData label={t('no_owner')} />;
  return <OwnerName tenantId={org.id} userId={ownerId} />;
};

OwnerInline.displayName = 'OwnerInline';

/** Mounted only once both ids are known: the lookup cannot be conditional. */
const OwnerName: React.FC<{ tenantId: string; userId: string }> = ({ tenantId, userId }) => {
  const t = useProjectListText();
  const { user, loading, failed } = useUserById(tenantId, userId);

  if (loading) return <Skeleton className={styles.cellSkeleton} />;
  if (failed) return <LoadFailed label={t('load_failed')} />;

  if (!user) return <NoData label={t('no_owner')} />;

  return <span className={styles.ownerName}>{displayName(user)}</span>;
};

OwnerName.displayName = 'OwnerName';
