/** The organization's workspaces */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  apiRegistry,
  useApiQuery,
  useFormatters,
  useMfeBridge,
  useSharedProperty,
} from "@gears-frontx/react";
import { Folder } from "lucide-react";
import {
  DataGridEmptyStatePlugin,
  DataGridPaginationPlugin,
  DataGridRowClickPlugin,
  DataGridTextSearchPlugin,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  useDataGrid,
} from "@gears-frontx/ui-kit";
import {
  useOrganization,
  useThemedRoot,
  AccountsApiService,
  LIST_PAGE_LIMITS,
  ListGrid,
  ListNoMatch,
  ListReadFailed,
  matchesSearch,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  useListRows,
  type OrganizationRef,
  type Tenant,
} from "@constructor-studio/mfe-shared";
import { requestWorkspace } from "../../actions/workspaceActions";
import { useWorkspacesScreenTranslations, useWorkspacesText } from "../../i18n";
import { WorkspacesHeader } from "./components/WorkspacesHeader";
import { workspaceColumns } from "./components/workspaceColumns";
import styles from "./WorkspacesScreen.module.css";

const WorkspacesEmpty: React.FC = () => {
  const t = useWorkspacesText();
  const grid = useDataGrid<Tenant>();
  const filtered = grid.useStore((state) => state.hasActiveFilters);

  if (filtered) {
    return <ListNoMatch message={t("empty_search")} clearLabel={t("clear_search")} />;
  }
  return (
    <Empty className={styles.empty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>{t("empty_title")}</EmptyTitle>
        <EmptyDescription>{t("empty_hint")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

WorkspacesEmpty.displayName = "WorkspacesEmpty";

function searchWorkspaces(rows: readonly Tenant[], text: string): readonly Tenant[] {
  return rows.filter((row) => matchesSearch(text, row.name));
}

// @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-level:p1
const WorkspaceList: React.FC<{
  organization: OrganizationRef;
  translationsPending: boolean;
}> = ({ organization, translationsPending }) => {
  const bridge = useMfeBridge();
  const accounts = apiRegistry.getService(AccountsApiService);
  const t = useWorkspacesText();
  const { formatRelative } = useFormatters();
  const [container, findThemedRoot] = useThemedRoot();
  // `staleTime: 0` is what makes the `refetch()` below reach the network, and
  // is not an accidental opt-out of the shared 30s default. There are two
  // caches, and this number is handed to both: react-query's, whose staleness
  // `refetch()` does override, and the one inside `descriptor.fetch`
  // (`SharedFetchCache`, also 30s), which it does not — `queryFn` calls into it
  // on every refetch and only `staleTime <= 0` counts an entry as stale there.
  // Raise this and creating a workspace stops adding a row for up to 30s: the
  // effect still calls `refetch()`, and no request is made.
  const { data, isLoading, isError, refetch } = useApiQuery(
    accounts.getWorkspaces({ organizationId: organization.id }),
    { staleTime: 0 },
  );

  const scopedWorkspace = useSharedProperty(
    STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  );
  const seenScoped = useRef(false);
  useEffect(() => {
    if (!seenScoped.current) {
      seenScoped.current = true;
      return;
    }
    void refetch();
  }, [scopedWorkspace, refetch]);

  const all = useMemo(() => data?.items ?? [], [data]);

  const projectTotal = useMemo(
    () => all.reduce((sum, row) => sum + (row.child_count ?? 0), 0),
    [all],
  );

  const { load, found, rowsBridge } = useListRows(all, searchWorkspaces);

  // @cpt-dod:cpt-studiofrontend-dod-workspaces-screen-row-opens:p1
  const open = useCallback(
    (row: Tenant) => {
      requestWorkspace(bridge, { id: row.id, name: row.name }, organization.id);
    },
    [bridge, organization.id],
  );

  const columns = useMemo(
    () =>
      workspaceColumns({
        labels: {
          workspace: t("col_workspace"),
          projects: t("col_projects"),
          issues: t("col_issues"),
          access: t("col_access"),
          configuration: t("col_configuration"),
          updated: t("col_updated"),
          noData: t("no_data"),
        },
        formatRelative,
      }),
    [t, formatRelative],
  );

  const pending = translationsPending || (isLoading && all.length === 0);
  const gridShown = !isError || all.length > 0;

  return (
    <div ref={findThemedRoot} className={styles.screen}>
      <WorkspacesHeader
        busy={pending}
        canCreate
        total={all.length}
        projectTotal={projectTotal}
      />

      <div className={styles.body}>
        {pending ? (
          <div className={styles.loading}>
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
          </div>
        ) : (
          <>
            {isError && (
              <ListReadFailed
                message={t("error_title")}
                retryLabel={t("retry")}
                onRetry={() => void refetch()}
              />
            )}
            {gridShown && (
              <ListGrid<Tenant>
                key={organization.id}
                name="workspaces"
                persistent="memory"
                label={t("table_label")}
                load={load}
                columns={columns}
                portalContainer={container ?? undefined}
                footer={found ? t.count("totals_workspaces", found) : null}
              >
                <DataGridTextSearchPlugin placeholder={t("search_placeholder")} />
                <DataGridPaginationPlugin
                  defaultLimit={LIST_PAGE_LIMITS[0]}
                  limits={LIST_PAGE_LIMITS}
                  autoHide
                />
                <DataGridEmptyStatePlugin component={WorkspacesEmpty} />
                <DataGridRowClickPlugin<Tenant> click={open} />
                {rowsBridge}
              </ListGrid>
            )}
          </>
        )}
      </div>
    </div>
  );
};

WorkspaceList.displayName = "WorkspaceList";

export const WorkspacesScreen: React.FC = () => {
  const { isLoaded, error: translationsFailed } =
    useWorkspacesScreenTranslations();
  const t = useWorkspacesText();
  const { org, loading } = useOrganization();
  const translationsPending = !isLoaded && !translationsFailed;

  if (!org) {
    return (
      <div className={styles.screen} data-state="no-organization">
        <WorkspacesHeader
          busy={loading || translationsPending}
          canCreate={false}
        />
        <p className={styles.note}>
          {loading ? t("resolving_org") : t("no_org")}
        </p>
      </div>
    );
  }

  return (
    <WorkspaceList
      organization={org}
      translationsPending={translationsPending}
    />
  );
};

WorkspacesScreen.displayName = "WorkspacesScreen";
