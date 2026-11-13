import React, { useMemo } from 'react';
import { Network } from 'lucide-react';
import {
  Button,
  DataGridEmptyStatePlugin,
  DataGridPaginationPlugin,
  DataGridTextSearchPlugin,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  useDataGrid,
} from '@gears-frontx/ui-kit';
import { useMfeBridge } from '@gears-frontx/react';
import {
  LIST_PAGE_LIMITS,
  ListGrid,
  ListNoMatch,
  ListReadFailed,
  SectionHeader,
  useOrganization,
  useThemedRoot,
} from '@constructor-studio/mfe-shared';
import { useConnectionListScreenTranslations, useConnectionListText } from '../../i18n';
import { useConnectionList } from '../../shared/useConnectionList';
import type { ConnectionRow } from '../../model/connection';
import { openConnectDialog } from '../../actions/connectActions';
import { connectionColumns } from './components/connectionColumns';
import styles from './ConnectionListScreen.module.css';

const ConnectionsEmpty: React.FC = () => {
  const t = useConnectionListText();
  const { org } = useOrganization();
  const grid = useDataGrid<ConnectionRow>();
  const filtered = grid.useStore((state) => state.hasActiveFilters);

  if (filtered) {
    return <ListNoMatch message={t('empty_no_match')} clearLabel={t('clear_search')} />;
  }
  return (
    <Empty className={styles.empty}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Network />
        </EmptyMedia>
        <EmptyTitle>{t('empty_title')}</EmptyTitle>
        <EmptyDescription>{org ? t('empty_hint') : t('empty_no_org')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

ConnectionsEmpty.displayName = 'ConnectionsEmpty';

export const ConnectionListScreen: React.FC = () => {
  const { isLoaded, error: translationsFailed } = useConnectionListScreenTranslations();
  const t = useConnectionListText();
  const bridge = useMfeBridge();
  const [container, findThemedRoot] = useThemedRoot();

  const list = useConnectionList();
  const tenantId = list.org?.id ?? '';
  const columns = useMemo(() => connectionColumns(t, tenantId), [t, tenantId]);
  const busy = (!isLoaded && !translationsFailed) || list.loading;
  const gridShown = !list.failed || list.total > 0;

  return (
    <div ref={findThemedRoot} className={styles.screen}>
      <SectionHeader
        title={t('title')}
        busy={busy}
        actions={
          <Button size="sm" onClick={() => openConnectDialog(bridge)}>
            {t('connect_source')}
          </Button>
        }
      />

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
            {list.failed && (
              <ListReadFailed
                message={t('error_title')}
                retryLabel={t('retry')}
                onRetry={list.retry}
              />
            )}
            {gridShown && (
              <ListGrid<ConnectionRow>
                key={tenantId}
                name="connections"
                persistent="memory"
                label={t('title')}
                tableLayout="auto"
                load={list.load}
                columns={columns}
                portalContainer={container ?? undefined}
                footer={list.found ? t.count('count', list.found) : null}
              >
                <DataGridTextSearchPlugin placeholder={t('search_placeholder')} />
                <DataGridPaginationPlugin
                  defaultLimit={LIST_PAGE_LIMITS[0]}
                  limits={LIST_PAGE_LIMITS}
                  autoHide
                />
                <DataGridEmptyStatePlugin component={ConnectionsEmpty} />
                {list.rowsBridge}
              </ListGrid>
            )}
          </>
        )}
      </section>
    </div>
  );
};

ConnectionListScreen.displayName = 'ConnectionListScreen';
