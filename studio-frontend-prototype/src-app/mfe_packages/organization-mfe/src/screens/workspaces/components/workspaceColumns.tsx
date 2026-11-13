/** The columns of the workspaces table: the prototype's portfolio (`projects.tsx`). */

import React from "react";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@gears-frontx/ui-kit";
import type { Tenant } from "@constructor-studio/mfe-shared";
import { growthText, quietText } from "../../../overview/model";
import type { OrgWorkspace } from "../../../overview/types";
import { NoData } from "./NoData";
import styles from "../WorkspacesScreen.module.css";

export interface WorkspaceColumn {
  key: string;
  label: string;
  className: string;
  render: (row: Tenant) => React.ReactNode;
}

export interface WorkspaceColumnLabels {
  workspace: string;
  projects: string;
  spend: string;
  delta: string;
  failing: string;
  stuck: string;
  quiet: string;
  updated: string;
  actions: string;
  noData: string;
  open: string;
  rename: string;
  remove: string;
  showProjects: string;
  hideProjects: string;
}

export interface WorkspaceColumnDeps {
  labels: WorkspaceColumnLabels;
  formatRelative: (value: string) => string;
  /** The workspace's health in the organization overview, when it has one. */
  health: (row: Tenant) => OrgWorkspace | undefined;
  /** The line under the name: its worst project, or its projects by name. */
  summary: (row: Tenant) => string;
  cash: (value: number) => string;
  isExpanded: (row: Tenant) => boolean;
  onToggle: (row: Tenant) => void;
  onOpen: (row: Tenant) => void;
  onRename: (row: Tenant) => void;
  onDelete: (row: Tenant) => void;
}

const dash = (label: string) => <NoData label={label} />;

// @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-counts:p2
export function workspaceColumns({
  labels,
  formatRelative,
  health,
  summary,
  cash,
  isExpanded,
  onToggle,
  onOpen,
  onRename,
  onDelete,
}: WorkspaceColumnDeps): WorkspaceColumn[] {
  return [
    {
      key: "workspace",
      label: labels.workspace,
      className: styles.colName,
      render: (row) => {
        const projects = health(row)?.projects.length ?? 0;
        const open = isExpanded(row);
        return (
          <div className={styles.nameCell}>
            {projects > 0 ? (
              <button
                type="button"
                className={styles.expand}
                aria-expanded={open}
                aria-label={open ? labels.hideProjects : labels.showProjects}
                title={open ? labels.hideProjects : labels.showProjects}
                onClick={() => onToggle(row)}
                data-workspace-expand={row.id}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className={styles.expand} aria-hidden />
            )}
            {/* @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-row-opens:p1 */}
            <button type="button" className={styles.nameButton} onClick={() => onOpen(row)}>
              <span className={styles.rowGlyph} aria-hidden>
                <Building2 size={16} strokeWidth={1.3} />
              </span>
              <span className={styles.nameStack}>
                <span className={styles.name}>{row.name}</span>
                {summary(row) && (
                  <span className={styles.summary} data-workspace-description>
                    {summary(row)}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      },
    },
    {
      key: "projects",
      label: labels.projects,
      className: styles.colNum,
      render: (row) =>
        row.child_count === undefined ? (
          dash(labels.noData)
        ) : (
          <span className={styles.count}>{row.child_count}</span>
        ),
    },
    {
      key: "spend",
      label: labels.spend,
      className: styles.colNum,
      render: (row) => {
        const h = health(row);
        return h?.spend == null ? dash(labels.noData) : <span className={styles.count}>{cash(h.spend)}</span>;
      },
    },
    {
      key: "delta",
      label: labels.delta,
      className: styles.colNum,
      render: (row) => {
        const h = health(row);
        return h?.spend == null || h.previous === null ? (
          dash(labels.noData)
        ) : (
          <span className={styles.count}>{growthText(h.spend, h.previous)}</span>
        );
      },
    },
    {
      key: "failing",
      label: labels.failing,
      className: styles.colNum,
      render: (row) => {
        const h = health(row);
        return h?.specs_failing ? <span className={styles.count}>{h.specs_failing}</span> : dash(labels.noData);
      },
    },
    {
      key: "stuck",
      label: labels.stuck,
      className: styles.colNum,
      render: (row) => {
        const h = health(row);
        return h?.stuck ? <span className={styles.count}>{h.stuck}</span> : dash(labels.noData);
      },
    },
    {
      key: "quiet",
      label: labels.quiet,
      className: styles.colNum,
      render: (row) => {
        const days = health(row)?.quiet_days ?? null;
        return days === null ? dash(labels.noData) : <span className={styles.count}>{quietText(days)}</span>;
      },
    },
    {
      key: "updated",
      label: labels.updated,
      className: styles.colUpdated,
      render: (row) =>
        row.updated_at ? (
          <span className={styles.updated}>{formatRelative(row.updated_at)}</span>
        ) : (
          dash(labels.noData)
        ),
    },
    {
      key: "actions",
      label: labels.actions,
      className: styles.colActions,
      render: (row) => (
        <span className={styles.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
            {labels.open}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRename(row)} data-workspace-rename={row.id}>
            {labels.rename}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(row)} data-workspace-delete={row.id}>
            {labels.remove}
          </Button>
        </span>
      ),
    },
  ];
}
