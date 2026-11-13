/**
 * The deployment's FrontX starting points (the prototype's
 * `loadFrontxDefaults` / `useFrontxDefaults`, frontend-constructor-view.tsx):
 * `frontx` of `GET /studio-product/v1/gearbox` (`STUDIO_FRONTX_*`), asked once
 * per page load; the built-in templates until it answers or when it fails.
 */

import { useEffect, useState } from 'react';
import { productApi } from '../../../api/client';
import { frontxDefaultsOf, type FrontxDefaults } from '../../../model/frontend-constructor';

let frontxAsked: Promise<FrontxDefaults> | null = null;
let frontxKnown: FrontxDefaults | null = null;

export function loadFrontxDefaults(): Promise<FrontxDefaults> {
  frontxAsked ??= productApi.gearboxStatus().then(
    (st) => (frontxKnown = frontxDefaultsOf(st)),
    () => {
      // Asked again next time; the built-in templates meanwhile.
      frontxAsked = null;
      return frontxDefaultsOf(null);
    }
  );
  return frontxAsked;
}

/** For tests: forget what was asked. */
export function forgetFrontxDefaults(): void {
  frontxAsked = null;
  frontxKnown = null;
}

/** [`loadFrontxDefaults`] for a view: the built-in templates until it answers. */
export function useFrontxDefaults(): FrontxDefaults {
  const [d, setD] = useState<FrontxDefaults>(() => frontxKnown ?? frontxDefaultsOf(null));
  useEffect(() => {
    let alive = true;
    void loadFrontxDefaults().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}
