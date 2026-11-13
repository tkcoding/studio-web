import React from "react";
import { Search } from "lucide-react";
import { Button, Input, Skeleton } from "@gears-frontx/ui-kit";
import { useMfeBridge } from "@gears-frontx/react";
import { openWorkspaceForm } from "../../../actions/overlayActions";
import type { ScreenText } from "@constructor-studio/mfe-shared";
import { useWorkspacesText } from "../../../i18n";
import { MANAGED_FILTERS, type ManagedFilter } from "../model";
import styles from "../WorkspacesScreen.module.css";

interface WorkspacesToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
  canCreate: boolean;
  total?: number;
  projectTotal?: number;
  /** The organization the list is of, said beside the counts as the prototype did. */
  organizationName?: string;
  managed?: ManagedFilter;
  onManagedChange?: (filter: ManagedFilter) => void;
}

function totalsLine(t: ScreenText, total: number, projectTotal: number, organizationName?: string): string {
  const counts = `${t.count("totals_workspaces", total)} · ${t.count("totals_projects", projectTotal)}`;
  return organizationName ? `${counts} ${t("in_org", { name: organizationName })}` : counts;
}

const MANAGED_LABEL: Record<ManagedFilter, string> = {
  all: "filter_all",
  self: "filter_self",
  org: "filter_org",
};

export const WorkspacesToolbar: React.FC<WorkspacesToolbarProps> = ({
  query,
  onQueryChange,
  busy,
  canCreate,
  total,
  projectTotal,
  organizationName,
  managed,
  onManagedChange,
}) => {
  const bridge = useMfeBridge();
  const t = useWorkspacesText();

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label={t("toolbar_label")}
    >
      <div className={styles.heading}>
        <h2 className={styles.title}>
          {busy ? <Skeleton className={styles.titleSkeleton} /> : t("title")}
        </h2>
        {!busy && total !== undefined && projectTotal !== undefined && (
          <p className={styles.totals}>{totalsLine(t, total, projectTotal, organizationName)}</p>
        )}
      </div>

      <div className={styles.controls}>
        {managed && onManagedChange && (
          <div className={styles.chips} role="group" aria-label={t("filter_label")}>
            {MANAGED_FILTERS.map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={managed === filter ? "secondary" : "ghost"}
                aria-pressed={managed === filter}
                onClick={() => onManagedChange(filter)}
                data-workspace-filter={filter}
              >
                {t(MANAGED_LABEL[filter])}
              </Button>
            ))}
          </div>
        )}
        <Input
          className={styles.search}
          type="search"
          value={query}
          icon={<Search size={16} strokeWidth={1.3} />}
          placeholder={t("search_placeholder")}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={t("search_placeholder")}
        />
        {/* @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-create-moves:p1 */}
        <Button
          size="sm"
          disabled={!canCreate}
          title={canCreate ? undefined : t("new_workspace_no_org")}
          onClick={() => openWorkspaceForm(bridge)}
        >
          {t("new_workspace")}
        </Button>
      </div>
    </div>
  );
};

WorkspacesToolbar.displayName = "WorkspacesToolbar";
