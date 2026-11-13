// Moving between portal places from deep inside a screen.
//
// The platform component catalogue (`view === "gears"`) is where a component's
// page lives — its fields, versions, sources. A project that names a component
// (a product's picked gears, a suggestion) should lead there rather than
// restate it, and the view state that decides what is on screen belongs to
// `App`. This is the seam: `App` provides it, any view calls it.
import { createContext, useContext } from "react";

export interface PortalNav {
  /** Open the platform catalogue on one component's page, by its catalogue
   *  name (`cf-gears-api-gateway`). */
  openComponent: (name: string) => void;
}

const PortalNavContext = createContext<PortalNav | null>(null);

export const PortalNavProvider = PortalNavContext.Provider;

/** Null outside the portal shell; callers render plain text then. */
export function usePortalNav(): PortalNav | null {
  return useContext(PortalNavContext);
}
