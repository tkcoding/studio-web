import React, { useCallback, useMemo, useState } from "react";
import { useFormatters } from "@gears-frontx/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@gears-frontx/ui-kit";
import type { Tenant } from "@constructor-studio/mfe-shared";
import { useWorkspacesText } from "../../../i18n";
import { quietText, reasonLine } from "../../../overview/model";
import type { OrgWorkspace } from "../../../overview/types";
import { workspaceSummary } from "../model";
import { workspaceColumns } from "./workspaceColumns";
import styles from "../WorkspacesScreen.module.css";

interface WorkspacesTableProps {
  rows: readonly Tenant[];
  total: number;
  empty: React.ReactNode;
  onOpen: (row: Tenant) => void;
  onRename?: (row: Tenant) => void;
  onDelete?: (row: Tenant) => void;
  /** A workspace's health in the organization overview; none while it is unread or refused. */
  health?: (row: Tenant) => OrgWorkspace | undefined;
  /** The overview's threshold for a stuck pull request, in days. */
  stuckDays?: number;
  cash?: (value: number) => string;
}

const noHealth = () => undefined;
const noop = () => undefined;
const plain = (value: number) => String(Math.round(value));

export const WorkspacesTable: React.FC<WorkspacesTableProps> = ({
  rows,
  total,
  empty,
  onOpen,
  onRename = noop,
  onDelete = noop,
  health = noHealth,
  stuckDays = 7,
  cash = plain,
}) => {
  const { formatRelative } = useFormatters();
  const t = useWorkspacesText();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (row: Tenant) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      }),
    [],
  );

  const columns = useMemo(
    () =>
      workspaceColumns({
        labels: {
          workspace: t("col_workspace"),
          projects: t("col_projects"),
          spend: t("col_spend"),
          delta: t("col_delta"),
          failing: t("col_failing"),
          stuck: t("col_stuck", { days: stuckDays }),
          quiet: t("col_quiet"),
          updated: t("col_updated"),
          actions: t("col_actions"),
          noData: t("no_data"),
          open: t("open"),
          rename: t("rename"),
          remove: t("delete"),
          showProjects: t("show_projects"),
          hideProjects: t("hide_projects"),
        },
        formatRelative,
        health,
        summary: (row) => workspaceSummary(row, health(row), stuckDays),
        cash,
        isExpanded: (row) => expanded.has(row.id),
        onToggle: toggle,
        onOpen,
        onRename,
        onDelete,
      }),
    [t, formatRelative, health, stuckDays, cash, expanded, toggle, onOpen, onRename, onDelete],
  );

  return (
    <>
      <Table label={t("table_label")} className={styles.table}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length}>
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const h = expanded.has(row.id) ? health(row) : undefined;
              return (
                <React.Fragment key={row.id}>
                  <TableRow data-workspace-row={row.id}>
                    {columns.map((column) => (
                      <TableCell key={column.key} className={column.className}>
                        {column.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {h && (
                    <TableRow data-workspace-projects={row.id}>
                      <TableCell colSpan={columns.length} className={styles.projectsCell}>
                        <ul className={styles.projects}>
                          {h.projects.map((p) => (
                            <li key={p.id} data-workspace-project={p.id}>
                              <span className={styles.name}>{p.name}</span>
                              <span className={styles.summary}>
                                {p.reasons.length > 0 ? reasonLine(p.reasons, stuckDays) : t("project_fine")}
                              </span>
                              <span className={styles.projectFacts}>
                                {p.spend !== null && <span>{t("fact_spend", { value: cash(p.spend) })}</span>}
                                {p.specs_failing ? <span>{t("fact_failing", { count: p.specs_failing })}</span> : null}
                                {p.stuck ? <span>{t("fact_stuck", { count: p.stuck, days: stuckDays })}</span> : null}
                                {p.quiet_days !== null && (
                                  <span>{t("fact_quiet", { value: quietText(p.quiet_days) })}</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className={styles.summary}>{t("projects_open_hint")}</p>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className={styles.footer}>
        <span className={styles.range}>
          {t.count("range", total, {
            from: rows.length === 0 ? 0 : 1,
            to: rows.length,
            total,
          })}
        </span>
      </div>
    </>
  );
};

WorkspacesTable.displayName = "WorkspacesTable";
