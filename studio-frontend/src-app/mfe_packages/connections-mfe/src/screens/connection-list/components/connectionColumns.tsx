import React from 'react';
import type { DataGridTableColumn } from '@gears-frontx/ui-kit';
import type { ScreenText } from '@constructor-studio/mfe-shared';
import type { ConnectionRow } from '../../../model/connection';
import { ProviderGlyph } from './ProviderGlyph';
import { HealthInline } from './HealthInline';
import { NoData } from './NoData';
import styles from '../ConnectionListScreen.module.css';

// @cpt-dod:cpt-studiofrontend-dod-connection-list-gaps:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-list-read:p2

const ConnectionCell: React.FC<{ row: ConnectionRow }> = ({ row }) => {
  const { connection, providerName } = row;
  return (
    <span className={styles.nameCell}>
      <ProviderGlyph code={connection.provider} label={providerName} />
      <span className={styles.nameText}>
        <span className={styles.name}>{connection.label}</span>
        <span className={styles.subtitle}>
          {connection.account} · {connection.scope}
        </span>
      </span>
    </span>
  );
};

ConnectionCell.displayName = 'ConnectionCell';

export function connectionColumns(
  t: ScreenText,
  tenantId: string
): DataGridTableColumn<ConnectionRow>[] {
  return [
    {
      id: 'connection',
      label: t('col_connection'),
      render: (row) => <ConnectionCell row={row} />,
    },
    {
      id: 'status',
      label: t('col_status'),
      cellOverflow: 'nowrap',
      render: (row) => <HealthInline connectionId={row.connection.id} tenantId={tenantId} />,
    },
    // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-5
    {
      id: 'available',
      label: t('col_available'),
      cellOverflow: 'nowrap',
      render: () => <NoData label={t('no_data')} />,
    },
    {
      id: 'projects',
      label: t('col_projects'),
      cellOverflow: 'nowrap',
      render: () => <NoData label={t('no_projects')} />,
    },
    {
      id: 'last_sync',
      label: t('col_last_sync'),
      cellOverflow: 'nowrap',
      render: () => <NoData label={t('no_sync')} />,
    },
    {
      id: 'actions',
      label: t('col_actions'),
      cellOverflow: 'nowrap',
      render: () => <NoData label={t('no_actions')} />,
    },
    // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-5
  ];
}
