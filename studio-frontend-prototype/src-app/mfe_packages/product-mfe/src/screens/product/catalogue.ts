/**
 * The engine's gear catalogue, as the map and the configurator read it (the
 * prototype's `useGearCatalogue` in product-configurator-view.tsx): read once
 * per project; null while it is read.
 */

import { useEffect, useState } from 'react';
import { productApi } from '../../api/client';
import { indexCatalogue, type CatalogueIndex } from '../../model/product-configurator';
import { errText } from '../common';

export type Catalogue = { index: CatalogueIndex } | { error: string } | null;

/** `projectId`: the project on screen, whose own roots are "this project". */
export function useGearCatalogue(on: boolean, projectId?: string): Catalogue {
  const [read, setRead] = useState<Catalogue>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    productApi
      .gearboxCatalogue()
      .then((r) => live && setRead({ index: indexCatalogue(r.catalogue, r, projectId) }))
      .catch((e: unknown) => live && setRead({ error: errText(e) }));
    return () => {
      live = false;
    };
  }, [on, projectId]);
  return read;
}
