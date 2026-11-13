/** The columns of the projects table */

import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { DataGridTableColumn } from '@gears-frontx/ui-kit';
import type { Tenant } from '@constructor-studio/mfe-shared';
import { useProjectConfig } from '../../../shared/useProjectConfig';
import { NoData } from './NoData';
import { OwnerInline } from './OwnerInline';
import { ProjectStatusInline } from './StatusInline';
import styles from '../ProjectListScreen.module.css';

export interface ProjectColumnLabels {
  project: string;
  status: string;
  issues: string;
  movement: string;
  owner: string;
  updated: string;
  noData: string;
}

export interface ProjectColumnDeps {
  labels: ProjectColumnLabels;
  formatRelative: (value: string) => string;
}

const StatusCell: React.FC<{ project: Tenant }> = ({ project }) => {
  const state = useProjectConfig(project.id);
  return <ProjectStatusInline tenant={project} state={state} />;
};

StatusCell.displayName = 'StatusCell';

const OwnerCell: React.FC<{ project: Tenant }> = ({ project }) => {
  const state = useProjectConfig(project.id);
  return <OwnerInline state={state} />;
};

OwnerCell.displayName = 'OwnerCell';

export function projectColumns({
  labels,
  formatRelative,
}: ProjectColumnDeps): DataGridTableColumn<Tenant>[] {
  return [
    {
      id: 'project',
      label: labels.project,
      render: (row) => (
        <span className={styles.nameCell}>
          <span className={styles.rowGlyph} aria-hidden>
            <FileSpreadsheet size={16} strokeWidth={1.3} />
          </span>
          <span className={styles.name}>{row.name}</span>
        </span>
      ),
    },
    {
      id: 'status',
      label: labels.status,
      width: '15%',
      render: (row) => <StatusCell project={row} />,
    },
    {
      id: 'issues',
      label: labels.issues,
      width: '11%',
      cellOverflow: 'nowrap',
      render: () => <NoData label={labels.noData} />,
    },
    {
      id: 'movement',
      label: labels.movement,
      width: '15%',
      cellOverflow: 'nowrap',
      render: () => <NoData label={labels.noData} />,
    },
    {
      id: 'owner',
      label: labels.owner,
      width: '15%',
      cellOverflow: 'nowrap',
      render: (row) => <OwnerCell project={row} />,
    },
    {
      id: 'updated',
      label: labels.updated,
      width: '12%',
      cellOverflow: 'nowrap',
      render: (row) => <span className={styles.updated}>{formatRelative(row.updated_at)}</span>,
    },
  ];
}
