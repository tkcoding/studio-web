/**
 * The repositories of one connection, narrowed by the step's search box.
 */

import { apiRegistry, useApiQuery } from '@gears-frontx/react';
import { ConnectorsApiService, REPOSITORY_PAGE_LIMIT, type RemoteRepoDto } from '@constructor-studio/mfe-shared';

export interface RepositoriesView {
  repositories: readonly RemoteRepoDto[];
  loading: boolean;
  failed: boolean;
}

export function useRepositories(
  connectionId: string,
  orgId: string,
  search: string
): RepositoriesView {
  const connectors = apiRegistry.getService(ConnectorsApiService);
  const { data, isLoading, isError } = useApiQuery(
    connectors.repositories({
      connectionId,
      tenantId: orgId,
      search: search.trim() || undefined,
      limit: REPOSITORY_PAGE_LIMIT,
    })
  );

  return {
    repositories: data?.items ?? [],
    loading: isLoading,
    failed: isError,
  };
}
