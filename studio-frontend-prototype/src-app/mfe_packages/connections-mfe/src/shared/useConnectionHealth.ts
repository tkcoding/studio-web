// @cpt-dod:cpt-studiofrontend-dod-connection-list-health:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-list-health:p2
import { useQuery } from '@tanstack/react-query';
import { apiRegistry } from '@gears-frontx/react';
import {
  ConnectorsApiService,
  refusalText,
  violationOfType,
  type Violation,
} from '@constructor-studio/mfe-shared';
import type { ConnectionHealth } from '../model/connection';

/** Long enough that a re-render is free; short enough that a fix shows up. */
const HEALTH_STALE_TIME = 5 * 60 * 1000;

const CREDENTIAL_UNUSABLE = 'CONNECTOR_CREDENTIAL_UNUSABLE';

export interface ConnectionHealthView {
  health: ConnectionHealth | null;
  reason: string | null;
  loading: boolean;
  failed: boolean;
}

function reasonFor(error: unknown, refusal: Violation): string | null {
  const described = refusal.description;
  if (typeof described === 'string' && described.trim()) return described;
  return refusalText(error);
}

export function useConnectionHealth(
  connectionId: string,
  tenantId: string
): ConnectionHealthView {
  const connectors = apiRegistry.getService(ConnectorsApiService);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-1
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-2
  const { isPending, isError, error } = useQuery({
    queryKey: ['studio-connector', 'connection-health', tenantId, connectionId],
    queryFn: ({ signal }) =>
      connectors.connectionTest({ connectionId, tenantId }).fetch(undefined, { signal }),
    enabled: Boolean(tenantId && connectionId),
    retry: false,
    staleTime: HEALTH_STALE_TIME,
    gcTime: HEALTH_STALE_TIME,
    refetchOnWindowFocus: false,
  });
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-1
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-2

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-4
  if (isPending) return { health: null, reason: null, loading: true, failed: false };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-4

  if (isError) {
    const refusal = violationOfType(error, CREDENTIAL_UNUSABLE);

    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-6
    if (!refusal) return { health: null, reason: null, loading: false, failed: true };
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-6

    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-8
    return {
      health: 'unusable',
      reason: reasonFor(error, refusal),
      loading: false,
      failed: false,
    };
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-8
  }

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-9
  return { health: 'healthy', reason: null, loading: false, failed: false };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-9
}
