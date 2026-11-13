import { AccountsApiService, PROJECT_CONFIG_TYPE, type ProjectConfig } from '@constructor-studio/mfe-shared';
import { apiRegistry, useApiQuery } from '@gears-frontx/react';

/**
 * A project's attributes. One request per project — the metadata lives on the
 * project tenant, and AM has no bulk metadata read — which is fine inside a row
 * component: React Query dedupes and caches per tenant id.
 */
export interface ProjectConfigState {
  config: ProjectConfig | null;
  loading: boolean;
  /** Metadata was never written for this project (404), which is not an error. */
  unset: boolean;
  failed: boolean;
}

/** One key for every read and invalidation of the config. */
export function projectConfigQuery(accounts: AccountsApiService, projectId: string) {
  return accounts.getTenantMetadata<ProjectConfig>({
    tenantId: projectId,
    metadataType: PROJECT_CONFIG_TYPE,
  });
}

export function useProjectConfig(tenantId: string): ProjectConfigState {
  const accounts = apiRegistry.getService(AccountsApiService);
  const { data, isLoading, isError } = useApiQuery(projectConfigQuery(accounts, tenantId));

  return {
    config: data?.value ?? null,
    loading: isLoading,
    unset: !isLoading && !isError && data === null,
    failed: isError,
  };
}
