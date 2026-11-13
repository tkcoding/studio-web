// The prototype's src/declared-profiles.ts at 00828880; the profiles are the
// server's reading of the description now (`POST product-description-outlines`).
// The profiles a project's saved description declares, read once per view.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { type DeclaredProfile, declaredProfiles } from "./product";

type Read = { id: string; kind: string }[] | null;

const readLatest = (token: string, projectId: string): Promise<Read> =>
  api
    .outlineProductDescription(token, projectId, {})
    .then((o) => o.profiles ?? null)
    .catch(() => null);

/** The saved description's profiles, read from its latest revision; the
 *  profiles a new description starts with until it is read, and when the
 *  project has none. */
export function useDeclaredProfiles(token: string, projectId: string): DeclaredProfile[] {
  const [read, setRead] = useState<Read>(null);
  useEffect(() => {
    let live = true;
    void readLatest(token, projectId).then((r) => live && setRead(r));
    return () => {
      live = false;
    };
  }, [token, projectId]);
  return declaredProfiles(read);
}

/** The same, read once, for an action that needs it now. */
export async function readDeclaredProfiles(token: string, projectId: string): Promise<DeclaredProfile[]> {
  return declaredProfiles(await readLatest(token, projectId));
}
