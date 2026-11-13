/**
 * The source hosts the wizard can import from — one tab per connection.
 */

import { useMemo } from 'react';
import { apiRegistry, useApiQuery } from '@gears-frontx/react';
import {
  type ConnectionDto,
  type ConnectionsParams,
  ConnectorsApiService,
} from '@constructor-studio/mfe-shared';

/** `ProviderDto.category` of a driver whose repositories can be browsed. */
const SOURCE_CODE_CATEGORY = 'source_code';

export interface SourceProvider {
  provider: string;
  displayName: string;
}

export interface ConnectionsView {
  providers: readonly SourceProvider[];
  /** Source hosts only, in catalogue order. */
  connections: readonly ConnectionDto[];
  byId: ReadonlyMap<string, ConnectionDto>;
  loading: boolean;
  failed: boolean;
  providerName: (provider: string) => string;
}

interface ProviderFacts {
  displayName: string;
  category: string;
}

/**
 * What a project's sources resolve their connections against: the project's
 * own together with its workspace's and its organization's (#1043). Reading
 * the organization alone left a repository attached through the project's
 * own connection "Not connected".
 */
export function projectConnectionsParams(projectId: string): ConnectionsParams {
  return { tenantId: projectId, withAncestors: true };
}

/**
 * The source-host connections of `orgId`, or — with `projectId` — the
 * project's own and everything above it (`projectConnectionsParams`).
 */
export function useSourceConnections(orgId: string, projectId?: string | null): ConnectionsView {
  const connectors = apiRegistry.getService(ConnectorsApiService);

  const {
    data: providerData,
    isLoading: providersLoading,
    isError: providersFailed,
  } = useApiQuery(connectors.providers);

  const {
    data: connectionData,
    isLoading: connectionsLoading,
    isError: connectionsFailed,
  } = useApiQuery(
    connectors.connections(projectId ? projectConnectionsParams(projectId) : { tenantId: orgId })
  );

  const catalogue = useMemo(() => {
    const facts = new Map<string, ProviderFacts>(
      (providerData?.items ?? []).map((provider) => [
        provider.provider,
        { displayName: provider.display_name, category: provider.category },
      ])
    );

    const providers = (providerData?.items ?? [])
      .filter((provider) => provider.category === SOURCE_CODE_CATEGORY)
      .map((provider) => ({ provider: provider.provider, displayName: provider.display_name }));

    const connections = (connectionData?.items ?? []).filter(
      (connection) => facts.get(connection.provider)?.category === SOURCE_CODE_CATEGORY
    );

    return {
      providers,
      connections,
      byId: new Map(connections.map((connection) => [connection.id, connection])),
      providerName: (provider: string) => facts.get(provider)?.displayName ?? provider,
    };
  }, [providerData, connectionData]);

  return {
    ...catalogue,
    loading: connectionsLoading || providersLoading,
    failed: connectionsFailed || providersFailed,
  };
}
