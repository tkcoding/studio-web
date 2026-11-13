/**
 * The project's product as the server keeps it (the prototype's
 * `useProjectProduct` in kits.tsx): read on mount, and written back as picks
 * and settings change, so leaving the tab keeps what was chosen and every
 * screen that asks sees the same product.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  productApi,
  type GearboxStatus,
  type GearConfig,
  type ProductChange,
  type ProjectProduct,
} from '../../../api/client';
import { productIdFrom } from '../../../model/product';
import { errText } from '../../common';

export interface ProductState {
  /** The engine's status; null while loading or when the call failed. */
  gearbox: GearboxStatus | null;
  /** Whether previews run here at all. */
  composing: boolean;
  /** The saved record has been read, so picks can be written back. */
  loaded: boolean;
  record: ProjectProduct | null;
  /** The product's id and name: the record's, else the project's name's. */
  productId: string;
  name: string;
  picks: string[];
  setPicks: (update: (current: string[]) => string[]) => void;
  toggle: (name: string) => void;
  /** How the product configures its gears, kept and written with the picks. */
  config: GearConfig;
  /** Set one field of one gear; `undefined` removes it. */
  setField: (gear: string, field: string, value: unknown) => void;
  /** Re-read the record, after a preview wrote its verdict into it. */
  refresh: () => Promise<void>;
  /** What completion last changed, with its reasons; empty when nothing did. */
  adjustments: ProductChange[];
  /** Bumped whenever completion replaces the picks, so a preview can follow. */
  completedAt: number;
  /** Start the product from these picks, completed into a set that resolves. */
  seed: (picks: string[]) => Promise<void>;
  saveError: string | null;
}

export function useProjectProduct(projectId: string): ProductState {
  const [gearbox, setGearbox] = useState<GearboxStatus | null>(null);
  const [record, setRecord] = useState<ProjectProduct | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [picks, setPicksState] = useState<string[]>([]);
  const [config, setConfigState] = useState<GearConfig>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<ProductChange[]>([]);
  const [completedAt, setCompletedAt] = useState(0);
  // Set by the person's changes and cleared by a write, so what was just
  // read from the server is never written straight back.
  const dirty = useRef(false);

  useEffect(() => {
    let live = true;
    void Promise.all([
      productApi.gearboxStatus().catch(() => null),
      productApi.projectProduct(projectId).catch(() => null),
      productApi.tenant(projectId).then(
        (t) => t.name,
        () => null
      ),
    ]).then(([engine, saved, name]) => {
      if (!live) return;
      setGearbox(engine);
      setRecord(saved);
      setProjectName(name);
      setPicksState(saved?.gears ?? []);
      setConfigState(saved?.config ?? {});
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [projectId]);

  const name = record?.name ?? projectName ?? record?.product_id ?? projectId;
  const productId = record?.product_id ?? productIdFrom(projectName ?? name);

  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      productApi
        .saveProjectProduct(projectId, { product_id: productId, name, gears: picks, config })
        .then((saved) => {
          setRecord(saved.value);
          setSaveError(null);
        })
        .catch((cause) => setSaveError(errText(cause)));
    }, 400);
    return () => clearTimeout(timer);
  }, [picks, config, loaded, projectId, productId, name]);

  const setPicks = useCallback((update: (current: string[]) => string[]) => {
    dirty.current = true;
    setPicksState(update);
  }, []);

  // Completion is advice the person can undo: it replaces the picks, keeps
  // its reasons on screen, and if the engine is unreachable the picks stand.
  const seed = useCallback(
    async (start: string[]) => {
      try {
        const done = await productApi.completeProduct(start, config);
        setAdjustments(done.changes);
        dirty.current = true;
        setConfigState(done.config ?? {});
        setPicks(() => done.gears);
        setCompletedAt(Date.now());
      } catch (cause) {
        setSaveError(errText(cause));
        setPicks(() => start);
      }
    },
    [config, setPicks]
  );

  const refresh = useCallback(async () => {
    const saved = await productApi.projectProduct(projectId).catch(() => null);
    if (saved) setRecord(saved);
  }, [projectId]);

  return {
    gearbox,
    composing: gearbox?.enabled === true,
    loaded,
    record,
    productId,
    name,
    picks,
    setPicks,
    toggle: (gear) => {
      // A gear taken out takes its configuration with it.
      if (picks.includes(gear) && config[gear]) {
        setConfigState((current) => {
          const next = { ...current };
          delete next[gear];
          return next;
        });
      }
      setPicks((current) => (current.includes(gear) ? current.filter((n) => n !== gear) : [...current, gear]));
    },
    config,
    setField: (gear, field, value) => {
      dirty.current = true;
      setConfigState((current) => {
        const fields = { ...(current[gear] ?? {}) };
        if (value === undefined) delete fields[field];
        else fields[field] = value;
        const next = { ...current };
        if (Object.keys(fields).length === 0) delete next[gear];
        else next[gear] = fields;
        return next;
      });
    },
    refresh,
    saveError,
    adjustments,
    completedAt,
    seed,
  };
}
