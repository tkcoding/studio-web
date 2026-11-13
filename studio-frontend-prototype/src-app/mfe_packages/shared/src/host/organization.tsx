/**
 * Which organization the MFE is working in — told by the shell, not derived.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-create-org-scope:p1
// @cpt-dod:cpt-studiofrontend-dod-connection-create-scope:p1
import React, { createContext, useContext, type ReactNode } from 'react';
import { useSharedProperty } from '@gears-frontx/react';
import { STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION } from './hostProperties';

/** All the shell publishes, and all any screen reads. */
export interface OrganizationRef {
  id: string;
  name: string;
}

export interface OrganizationState {
  org: OrganizationRef | null;
  loading: boolean;
  failed: boolean;
}

const EMPTY: OrganizationState = { org: null, loading: false, failed: false };

const OrganizationContext = createContext<OrganizationState>(EMPTY);

/** Null `org` with `loading` false means: the shell says there is none. */
export function useOrganization(): OrganizationState {
  return useContext(OrganizationContext);
}

function isOrganizationRef(value: unknown): value is OrganizationRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Partial<OrganizationRef>;
  return typeof ref.id === 'string' && !!ref.id && typeof ref.name === 'string';
}

export const OrganizationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const published = useSharedProperty<unknown>(STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION);

  const value: OrganizationState =
    published === undefined
      ? { org: null, loading: true, failed: false }
      : { org: isOrganizationRef(published) ? published : null, loading: false, failed: false };

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
};

OrganizationProvider.displayName = 'OrganizationProvider';
