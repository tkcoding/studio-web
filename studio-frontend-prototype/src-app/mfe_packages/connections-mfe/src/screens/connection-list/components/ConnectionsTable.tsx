import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { useConnectionListText } from '../../../i18n';
import type { ConnectionRow } from '../../../shared/useConnectionList';
import { ProviderGlyph } from './ProviderGlyph';
import { HealthInline } from './HealthInline';
import { NoData } from './NoData';
import styles from '../ConnectionListScreen.module.css';

// @cpt-dod:cpt-studiofrontend-dod-connection-list-gaps:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-list-read:p2

interface ConnectionsTableProps {
  rows: readonly ConnectionRow[];
  tenantId: string;
  empty: React.ReactNode;
}

const Row: React.FC<{ row: ConnectionRow; tenantId: string }> = React.memo(({ row, tenantId }) => {
  const t = useConnectionListText();
  const { connection, providerName } = row;

  return (
    <TableRow>
      <TableCell className={styles.colConnection}>
        <span className={styles.nameCell}>
          <ProviderGlyph code={connection.provider} label={providerName} />
          <span className={styles.nameText}>
            <span className={styles.name}>{connection.label}</span>
            <span className={styles.subtitle}>
              {connection.account} · {connection.scope}
            </span>
          </span>
        </span>
      </TableCell>
      <TableCell className={styles.colStatus}>
        <HealthInline connectionId={connection.id} tenantId={tenantId} />
      </TableCell>
      {/* @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-5 */}
      <TableCell className={styles.colAvailable}>
        <NoData label={t('no_data')} />
      </TableCell>
      <TableCell className={styles.colProjects}>
        <NoData label={t('no_projects')} />
      </TableCell>
      <TableCell className={styles.colLastSync}>
        <NoData label={t('no_sync')} />
      </TableCell>
      <TableCell className={styles.colActions}>
        <NoData label={t('no_actions')} />
      </TableCell>
      {/* @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-5 */}
    </TableRow>
  );
});

Row.displayName = 'ConnectionRow';

export const ConnectionsTable: React.FC<ConnectionsTableProps> = ({ rows, tenantId, empty }) => {
  const t = useConnectionListText();

  return (
    <Table label={t('title')} className={styles.table}>
      <TableHeader>
        <TableRow>
          <TableHead className={styles.colConnection}>{t('col_connection')}</TableHead>
          <TableHead className={styles.colStatus}>{t('col_status')}</TableHead>
          <TableHead className={styles.colAvailable}>{t('col_available')}</TableHead>
          <TableHead className={styles.colProjects}>{t('col_projects')}</TableHead>
          <TableHead className={styles.colLastSync}>{t('col_last_sync')}</TableHead>
          <TableHead className={styles.colActions}>{t('col_actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6}>
              {empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => <Row key={row.connection.id} row={row} tenantId={tenantId} />)
        )}
      </TableBody>
    </Table>
  );
};

ConnectionsTable.displayName = 'ConnectionsTable';
