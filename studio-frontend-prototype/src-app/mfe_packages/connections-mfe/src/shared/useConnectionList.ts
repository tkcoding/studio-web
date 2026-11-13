// @cpt-algo:cpt-studiofrontend-algo-connection-list-read:p2
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRegistry, useApiQuery } from '@gears-frontx/react';
import { type ConnectionDto, ConnectorsApiService, type OrganizationRef, useOrganization } from '@constructor-studio/mfe-shared';

export interface ConnectionRow {
  connection: ConnectionDto;
  providerName: string;
}

export interface ConnectionListView {
  rows: ConnectionRow[];
  loading: boolean;
  failed: boolean;
  org: OrganizationRef | null;
  total: number;
}

export function matchesQuery(row: ConnectionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const { label, account, provider } = row.connection;
  return [label, account, provider, row.providerName].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

export function useConnectionList(query: string): ConnectionListView {
  const connectors = apiRegistry.getService(ConnectorsApiService);
  const { org, loading: orgLoading } = useOrganization();

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-2
  const { data: providerData, isLoading: providersLoading } = useApiQuery(connectors.providers);
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-2

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-1
  const listing = connectors.connections({ tenantId: org?.id ?? '' });
  const {
    data: connectionData,
    isLoading: connectionsLoading,
    isError: connectionsFailed,
  } = useQuery({
    queryKey: listing.key,
    queryFn: ({ signal }) => listing.fetch({ signal }),
    enabled: Boolean(org?.id),
  });
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-1

  const all = useMemo<ConnectionRow[]>(() => {
    const names = new Map(
      (providerData?.items ?? []).map((provider) => [provider.provider, provider.display_name])
    );
    return (connectionData?.items ?? []).map((connection) => ({
      connection,
      // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
      providerName: names.get(connection.provider) ?? connection.provider,
      // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
    }));
  }, [providerData, connectionData]);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-4
  const rows = useMemo(() => all.filter((row) => matchesQuery(row, query)), [all, query]);
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-4

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
  return {
    rows,
    loading: orgLoading || providersLoading || connectionsLoading,
    failed: connectionsFailed,
    org,
    total: all.length,
  };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
}
