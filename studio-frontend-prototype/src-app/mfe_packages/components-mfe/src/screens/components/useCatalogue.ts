/**
 * The catalogue as both Components screens read it (the prototype's
 * `ComponentsCatalog` reload): the nodes, with the kit registry's built-ins;
 * the profiles the editor writes; each component's fields with its sources
 * reconciled by the gear; the field schemas, and which types this
 * organization treats as components. Plus each component's earliest snapshot
 * in a window, for "since".
 */

import { useCallback, useEffect, useState } from 'react';
import type { CatalogNode, ComponentValues, StudioKit } from '../../api/types';
import type { ComponentSnapshot } from '../../model/field-trend';
import { componentTypesOf, indexSchemas, profilesByName, withKits, type Schemas } from '../../model/catalogue';
import { api, errText, statusOf } from './common';

export interface CatalogueData {
  /** Null while the first read is out. */
  gears: CatalogNode[] | null;
  profiles: Record<string, Record<string, unknown>>;
  resolved: Record<string, ComponentValues>;
  schemas: Schemas;
  /** The types this organization treats as components; null while unknown. */
  componentTypes: Set<string> | null;
  truncated: boolean;
  shadowed: string[];
  err: string | null;
}

const EMPTY: CatalogueData = {
  gears: null,
  profiles: {},
  resolved: {},
  schemas: {},
  componentTypes: null,
  truncated: false,
  shadowed: [],
  err: null,
};

export function useCatalogue(org: string | null): {
  data: CatalogueData;
  reload: () => void;
  setProfile: (name: string, profile: Record<string, unknown>) => void;
} {
  const [data, setData] = useState<CatalogueData>(EMPTY);
  const [tick, setTick] = useState(0);

  // The presentation of every component type, in one read: what each type
  // looks like, and which types this organization calls components.
  useEffect(() => {
    let live = true;
    api()
      .fieldSchemas({ org })
      .fetch({ staleTime: 0 })
      .then(({ schemas }) => {
        if (live) setData((d) => ({ ...d, schemas: indexSchemas(schemas ?? []), componentTypes: componentTypesOf(schemas ?? []) }));
      })
      // No schemas means no field cards; not knowing which types are
      // components must not read as "none of them are".
      .catch(() => {
        if (live) setData((d) => ({ ...d, schemas: {}, componentTypes: null }));
      });
    return () => {
      live = false;
    };
  }, [org]);

  useEffect(() => {
    let live = true;
    const read = async () => {
      const service = api();
      const [components, profiles, kits] = await Promise.all([
        service.components({ org }).fetch({ staleTime: 0 }),
        service
          .profiles({ org })
          .fetch({ staleTime: 0 })
          .catch((e: unknown): { nodes: CatalogNode[] } => {
            if (statusOf(e) === 404) return { nodes: [] };
            throw e;
          }),
        // Its own gear, so its own failure: a kit registry that is down leaves the gears listed.
        service.kits().catch((): StudioKit[] => []),
      ]);
      let resolved: Record<string, ComponentValues> = {};
      try {
        const answered = await service.componentValues({ org }).fetch({ staleTime: 0 });
        resolved = Object.fromEntries(answered.items.map((row) => [row.name, row]));
      } catch {
        // The table then shows what the node itself says, nothing merged onto it.
      }
      return { components, profiles, kits, resolved };
    };
    read()
      .then(({ components, profiles, kits, resolved }) => {
        if (!live) return;
        setData((d) => ({
          ...d,
          gears: withKits(components.nodes ?? [], kits),
          truncated: Boolean(components.truncated),
          shadowed: components.shadowed ?? [],
          profiles: profilesByName(profiles.nodes ?? []),
          resolved,
          err: null,
        }));
      })
      .catch((e: unknown) => {
        if (live) setData((d) => ({ ...d, err: errText(e) }));
      });
    return () => {
      live = false;
    };
  }, [org, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const setProfile = useCallback(
    (name: string, profile: Record<string, unknown>) =>
      setData((d) => ({ ...d, profiles: { ...d.profiles, [name]: profile } })),
    []
  );
  return { data, reload, setProfile };
}

const NO_SNAPSHOTS = new Map<string, ComponentSnapshot>();

/** Each component's earliest snapshot in the last `days` days; a backend
 *  without the history route leaves "since" off, with no error. */
export function useBaselines(
  org: string | null,
  days: number
): { status: 'loading' | 'ready' | 'error'; byName: Map<string, ComponentSnapshot> } {
  const [state, setState] = useState<{ key: string; status: 'ready' | 'error'; byName: Map<string, ComponentSnapshot> } | null>(null);
  const key = `${org ?? ''}:${days}`;
  useEffect(() => {
    let live = true;
    api()
      .componentHistory({ org, days })
      .fetch({ staleTime: 0 })
      .then((page) => {
        if (live) setState({ key, status: 'ready', byName: new Map(page.items.map((s) => [s.component, s])) });
      })
      .catch(() => {
        if (live) setState({ key, status: 'error', byName: new Map() });
      });
    return () => {
      live = false;
    };
  }, [org, days, key]);
  if (!state || state.key !== key) return { status: 'loading', byName: NO_SNAPSHOTS };
  return { status: state.status, byName: state.byName };
}
