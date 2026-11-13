/**
 * What the configurator reads beside the product (the prototype's hooks in
 * product-configurator-view.tsx): the Domain entities each gear keeps, what
 * each environment runs now, and the organization's explanations of gears.
 */

import { useCallback, useEffect, useState } from 'react';
import { productApi, type GearExplanation } from '../../../api/client';
import { layerOf } from '../../../model/domain-layers';
import { entityGears, gearRefs } from '../../../model/entity-gears';
import { runningNow, type Running } from '../../../model/gear-deploys-model';
import { explanationIndex, type CatalogueIndex, type ExplanationIndex } from '../../../model/product-configurator';
import { entitiesOf, type GlossaryEntry } from '../../../model/spec-model';
import { errText } from '../../common';

/** The project's Domain entities each catalogue gear keeps, by engine id
 *  (entity-gears.ts): read once the catalogue is there, from the model the
 *  documents were last read into. Empty when there is no model or it cannot
 *  be read: the map does not need it. */
export function useKeptEntities(projectId: string, index: CatalogueIndex | null): Map<string, string[]> {
  const [kept, setKept] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    if (!index) return;
    let live = true;
    Promise.all([
      productApi.specModel(projectId),
      productApi.glossary(projectId).catch(() => ({ items: [] as GlossaryEntry[], total: 0 })),
    ])
      .then(([model, glossary]) => {
        if (!live) return;
        const domain = entitiesOf(model.facts, glossary.items).filter((e) => layerOf(e) === 'domain');
        const { byGear } = entityGears(domain, gearRefs(index));
        setKept(new Map([...byGear].map(([id, es]) => [id, es.map((e) => e.name)])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId, index]);
  return kept;
}

/** What each environment the project deploys to runs now (gear-deploys-model.ts);
 *  null while read, or when this Studio keeps no deployments: the gears then
 *  say nothing about where they run. */
export function useRunning(projectId: string): Running[] | null {
  const [running, setRunning] = useState<Running[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      productApi.deployments({ project: projectId }),
      // Without the targets every run still shows; only `protected` is lost.
      productApi.projectTargets(projectId).catch(() => null),
    ])
      .then(([d, t]) => {
        if (live) setRunning(runningNow(d.items, t?.environments.map((e) => e.environment) ?? []));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);
  return running;
}

/** The organization's explanations of gears, and a way to keep a new one. */
export interface Explanations {
  byId: ExplanationIndex;
  /** Keep what the server answered for one gear. */
  put: (e: GearExplanation) => void;
  /** Why they could not be read; the tiles then show descriptions only. */
  error: string | null;
  /** The caller may change them: only organization (and platform)
   *  administrators do; everyone else reads. */
  mayManage: boolean;
}

export function useGearExplanations(): Explanations {
  const [byId, setById] = useState<Map<string, GearExplanation>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [mayManage, setMayManage] = useState(false);
  useEffect(() => {
    let live = true;
    productApi
      .gearExplanations()
      .then((r) => {
        if (!live) return;
        setById(explanationIndex(r.items));
        setMayManage(r.may_manage === true);
        setError(null);
      })
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, []);
  const put = useCallback((e: GearExplanation) => setById((current) => new Map(current).set(e.gear_id, e)), []);
  return { byId, put, error, mayManage };
}
