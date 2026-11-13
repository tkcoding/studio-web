/** The columns of the workspaces table */

import { Layers } from "lucide-react";
import type { DataGridTableColumn } from "@gears-frontx/ui-kit";
import type { Tenant } from "@constructor-studio/mfe-shared";
import { NoData } from "./NoData";
import styles from "../WorkspacesScreen.module.css";

export interface WorkspaceColumnLabels {
  workspace: string;
  projects: string;
  issues: string;
  access: string;
  configuration: string;
  updated: string;
  noData: string;
}

export interface WorkspaceColumnDeps {
  labels: WorkspaceColumnLabels;
  formatRelative: (value: string) => string;
}

// @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-counts:p2
export function workspaceColumns({
  labels,
  formatRelative,
}: WorkspaceColumnDeps): DataGridTableColumn<Tenant>[] {
  return [
    {
      id: "workspace",
      label: labels.workspace,
      render: (row) => (
        <span className={styles.nameCell}>
          <span className={styles.rowGlyph} aria-hidden>
            <Layers size={16} strokeWidth={1.3} />
          </span>
          <span className={styles.name}>{row.name}</span>
        </span>
      ),
    },
    {
      id: "projects",
      label: labels.projects,
      width: "12%",
      cellOverflow: "nowrap",
      render: (row) =>
        row.child_count === undefined ? (
          <NoData label={labels.noData} />
        ) : (
          <span className={styles.count}>{row.child_count}</span>
        ),
    },
    {
      id: "issues",
      label: labels.issues,
      width: "12%",
      cellOverflow: "nowrap",
      render: () => <NoData label={labels.noData} />,
    },
    {
      id: "access",
      label: labels.access,
      width: "16%",
      cellOverflow: "nowrap",
      render: () => <NoData label={labels.noData} />,
    },
    {
      id: "configuration",
      label: labels.configuration,
      width: "16%",
      cellOverflow: "nowrap",
      render: () => <NoData label={labels.noData} />,
    },
    {
      id: "updated",
      label: labels.updated,
      width: "10%",
      cellOverflow: "nowrap",
      render: (row) =>
        row.updated_at ? (
          <span className={styles.updated}>{formatRelative(row.updated_at)}</span>
        ) : (
          <NoData label={labels.noData} />
        ),
    },
  ];
}
