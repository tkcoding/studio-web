/**
 * What the shell reads for a level's tabs besides the manifests (ADR-0066):
 * the `shows` relations of the level's type in the organization's Studio
 * domain model, and the names the level's own settings document hides.
 *
 * The model is read again when the live channel says it changed (Admin ›
 * Studio domain model added or removed a tab), so a new tab shows without a
 * reload. Neither read hides anything when it fails: a model that will not
 * answer leaves the manifests' tabs, a settings document that will not answer
 * hides nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRegistry, useAppSelector } from '@gears-frontx/react';
import {
  AccountsApiService,
  DomainModelApiService,
  isTabLevel,
  levelSettingsType,
  modelOf,
  modelTabs,
  parseHiddenTabs,
  withHiddenTabs,
  type DomainModel,
  type ModelTab,
  type TabLevel,
} from '@constructor-studio/mfe-shared';
import type { ScreenLevel } from '@/app/mfe/screenLevels';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import { useStudioEvents } from '@/app/live/useLiveChannel';

const NO_TABS: ModelTab[] = [];

const selectContext = (state: Record<string, unknown>) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined;

/** The organization's model, re-read on `domain.model_changed`; null until (and unless) it answers. */
export function useOrganizationModel(orgId: string | null): DomainModel | null {
  const [read, setRead] = useState<{ orgId: string; model: DomainModel | null } | null>(null);
  const [tick, setTick] = useState(0);
  useStudioEvents((event) => {
    if (event.kind === 'domain.model_changed') setTick((n) => n + 1);
  });
  useEffect(() => {
    if (!orgId) return undefined;
    let live = true;
    apiRegistry
      .getService(DomainModelApiService)
      .types({ orgId })
      .fetch({ staleTime: 0 })
      .then(
        (res) => live && setRead({ orgId, model: modelOf(res) }),
        () => live && setRead({ orgId, model: null })
      );
    return () => {
      live = false;
    };
  }, [orgId, tick]);
  // An answer about another organization is not this one's.
  return read && read.orgId === orgId ? read.model : null;
}

/** The `shows` relations of `level`'s type, in the model's order; none above or beside the three levels. */
export function useLevelModelTabs(level: ScreenLevel): ModelTab[] {
  const orgId = useAppSelector((state) => selectContext(state)?.org?.id ?? null);
  const model = useOrganizationModel(isTabLevel(level) ? orgId : null);
  return useMemo(() => (model && isTabLevel(level) ? modelTabs(model, level) : NO_TABS), [model, level]);
}

/** The tenant whose settings document holds `level`'s hidden tabs. */
export function useLevelTenant(level: ScreenLevel): string | null {
  return useAppSelector((state) => {
    const context = selectContext(state);
    if (level === 'organization') return context?.org?.id ?? null;
    if (level === 'workspace') return context?.workspace?.id ?? null;
    if (level === 'project') return context?.project?.id ?? null;
    return null;
  });
}

export interface HiddenTabs {
  /** What the level's document hides, as saved. */
  hidden: string[];
  /** Saves `next` as the level's hidden tabs, every other field of the document kept. */
  save: ((next: string[]) => Promise<void>) | null;
}

const NOTHING_HIDDEN: string[] = [];

/** The names `tenantId`'s settings document hides from `level`'s tabs, and how to change them. */
export function useHiddenTabs(level: ScreenLevel, tenantId: string | null): HiddenTabs {
  const [read, setRead] = useState<{ key: string; hidden: string[] } | null>(null);
  const tabLevel: TabLevel | null = isTabLevel(level) ? level : null;
  const key = tabLevel && tenantId ? `${tabLevel}\u0000${tenantId}` : null;

  useEffect(() => {
    if (!tabLevel || !tenantId || !key) return undefined;
    let live = true;
    apiRegistry
      .getService(AccountsApiService)
      .getTenantMetadata<unknown>({ tenantId, metadataType: levelSettingsType(tabLevel) })
      .fetch({ staleTime: 0 })
      .then(
        (entry) => live && setRead({ key, hidden: parseHiddenTabs(entry?.value) }),
        // Not readable here: every tab shows — hiding is never the fallback.
        () => live && setRead({ key, hidden: NOTHING_HIDDEN })
      );
    return () => {
      live = false;
    };
  }, [tabLevel, tenantId, key]);

  const save = useCallback(
    async (next: string[]) => {
      if (!tabLevel || !tenantId || !key) return;
      const accounts = apiRegistry.getService(AccountsApiService);
      const type = levelSettingsType(tabLevel);
      // Read, changed, written back whole, as every other writer of the
      // document does, so its other fields (icon, sources, stages…) stay.
      const current = await accounts.getTenantMetadata<unknown>({ tenantId, metadataType: type }).fetch({ staleTime: 0 });
      await accounts.putTenantMetadata<Record<string, unknown>>(tenantId, type).fetch(withHiddenTabs(current?.value, next));
      setRead({ key, hidden: next });
    },
    [tabLevel, tenantId, key]
  );

  return {
    hidden: read && read.key === key ? read.hidden : NOTHING_HIDDEN,
    save: key ? save : null,
  };
}
