// @cpt-algo:cpt-studiofrontend-algo-connection-list-read:p2
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRegistry, useApiQuery, useQueryCache } from '@gears-frontx/react';
import {
  ConnectorsApiService,
  type ListRows,
  type OrganizationRef,
  useListRows,
  useOrganization,
} from '@constructor-studio/mfe-shared';
import { matchesQuery, type ConnectionRow } from '../model/connection';

export interface ConnectionListView extends ListRows<ConnectionRow> {
  loading: boolean;
  failed: boolean;
  org: OrganizationRef | null;
  total: number;
  retry: () => void;
}

function searchConnections(rows: readonly ConnectionRow[], query: string): readonly ConnectionRow[] {
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-4
  return rows.filter((row) => matchesQuery(row, query));
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-4
}

export function useConnectionList(): ConnectionListView {
  const connectors = apiRegistry.getService(ConnectorsApiService);
  const cache = useQueryCache();
  const { org, loading: orgLoading } = useOrganization();
  const tenantId = org?.id ?? '';

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-2
  const { data: providerData, isLoading: providersLoading } = useApiQuery(connectors.providers);
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-2

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-1
  const listing = connectors.connections({ tenantId });
  const {
    data: connectionData,
    isLoading: connectionsLoading,
    isError: connectionsFailed,
  } = useQuery({
    queryKey: listing.key,
    queryFn: ({ signal }) => listing.fetch({ signal }),
    enabled: Boolean(tenantId),
  });
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-1

  const all = useMemo<ConnectionRow[]>(() => {
    const names = new Map(
      (providerData?.items ?? []).map((provider) => [provider.provider, provider.display_name])
    );
    return (connectionData?.items ?? []).map((connection) => ({
      id: connection.id,
      connection,
      // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
      providerName: names.get(connection.provider) ?? connection.provider,
      // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
    }));
  }, [providerData, connectionData]);

  const rows = useListRows(all, searchConnections);

  const retry = useCallback(() => {
    void cache.invalidate(connectors.connections({ tenantId }));
  }, [cache, connectors, tenantId]);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
  return {
    loading: orgLoading || providersLoading || connectionsLoading,
    failed: connectionsFailed,
    org,
    total: all.length,
    retry,
    ...rows,
  };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
}
