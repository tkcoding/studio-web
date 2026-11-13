import React, { useCallback, useMemo } from 'react';
import { Folder } from 'lucide-react';
import {
  Button,
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
} from '@gears-frontx/ui-kit';
import { useFormatters, useMfeBridge } from '@gears-frontx/react';
import {
  LIST_PAGE_LIMITS,
  ListGrid,
  ListNoMatch,
  ListReadFailed,
  SectionHeader,
  matchesSearch,
  useListRows,
  useThemedRoot,
  type Tenant,
} from '@constructor-studio/mfe-shared';
import { useProjectListScreenTranslations, useProjectListText } from '../../i18n';
import { WorkspaceProjectsProvider, useWorkspaceProjects } from '../../shared/workspaceProjects';
import { DEFAULT_SORT_OPTION, tenantComparator } from '../../model/project';
import { openProjectWizard } from '../../actions/wizardActions';
import { requestOpenProject } from '../../actions/projectsActions';
import { projectColumns } from './components/projectColumns';
import styles from './ProjectListScreen.module.css';

const ProjectsEmpty: React.FC = () => {
  const t = useProjectListText();
  const { org, workspace } = useWorkspaceProjects();
  const grid = useDataGrid<Tenant>();
  const filtered = grid.useStore((state) => state.hasActiveFilters);

  if (filtered) {
    return <ListNoMatch message={t('empty_no_match')} clearLabel={t('clear_search')} />;
  }
  return (
    <Empty className={styles.empty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>{t('empty_title')}</EmptyTitle>
        <EmptyDescription>
          {!org ? t('empty_no_org') : !workspace ? t('empty_no_workspace') : t('empty_hint')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

ProjectsEmpty.displayName = 'ProjectsEmpty';

function searchProjects(rows: readonly Tenant[], text: string): readonly Tenant[] {
  return rows.filter((row) => matchesSearch(text, row.name));
}

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-no-workspace:p1
const ProjectList: React.FC = () => {
  const { isLoaded, error: translationsFailed } = useProjectListScreenTranslations();
  const t = useProjectListText();
  const bridge = useMfeBridge();
  const { formatRelative } = useFormatters();
  const [container, findThemedRoot] = useThemedRoot();
  const { loading, failed, workspace, projects, refetch } = useWorkspaceProjects();

  const rows = useMemo(
    () => [...projects].sort(tenantComparator(DEFAULT_SORT_OPTION)),
    [projects]
  );
  const { load, found, rowsBridge } = useListRows(rows, searchProjects);

  const open = useCallback(
    (project: Tenant) => {
      if (!workspace) return;
      const siblings = projects.map((sibling) => ({ id: sibling.id, name: sibling.name }));
      requestOpenProject({ id: project.id, name: project.name }, siblings, bridge, workspace.id);
    },
    [bridge, projects, workspace]
  );

  const columns = useMemo(
    () =>
      projectColumns({
        labels: {
          project: t('col_project'),
          status: t('col_status'),
          issues: t('col_issues'),
          movement: t('col_movement'),
          owner: t('col_owner'),
          updated: t('col_updated'),
          noData: t('no_data'),
        },
        formatRelative,
      }),
    [t, formatRelative]
  );

  const busy = (!isLoaded && !translationsFailed) || loading;
  const gridShown = !failed || rows.length > 0;

  const actions = () => (
    <Button
      size="sm"
      disabled={!workspace}
      title={workspace ? undefined : t('empty_no_workspace')}
      onClick={() => openProjectWizard(bridge)}
    >
      {t('new_project')}
    </Button>
  );

  return (
    <div ref={findThemedRoot} className={styles.screen}>
      <SectionHeader title={t('title')} busy={busy} actions={actions()} />

      <section className={styles.body}>
        {busy ? (
          <div className={styles.rowsSkeleton}>
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
            <Skeleton className={styles.rowSkeleton} />
          </div>
        ) : translationsFailed ? (
          <p className={styles.state}>Could not load this screen.</p>
        ) : (
          <>
            {failed && (
              <ListReadFailed message={t('error_title')} retryLabel={t('retry')} onRetry={refetch} />
            )}
            {gridShown && (
              <ListGrid<Tenant>
                key={workspace?.id}
                name="projects"
                persistent="memory"
                label={t('title')}
                load={load}
                columns={columns}
                portalContainer={container ?? undefined}
                footer={found ? t.count('totals_projects', found) : null}
              >
                <DataGridTextSearchPlugin placeholder={t('search_placeholder')} />
                <DataGridPaginationPlugin
                  defaultLimit={LIST_PAGE_LIMITS[0]}
                  limits={LIST_PAGE_LIMITS}
                  autoHide
                />
                <DataGridEmptyStatePlugin component={ProjectsEmpty} />
                <DataGridRowClickPlugin<Tenant> click={open} />
                {rowsBridge}
              </ListGrid>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export const ProjectListScreen: React.FC = () => (
  <WorkspaceProjectsProvider>
    <ProjectList />
  </WorkspaceProjectsProvider>
);

ProjectListScreen.displayName = 'ProjectListScreen';
