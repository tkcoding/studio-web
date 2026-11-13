/**
 * Which workspace the MFE is working in — told by the shell, not derived.
 */

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-list-root:p1
import React, { createContext, useContext, type ReactNode } from 'react';
import { useSharedProperty } from '@gears-frontx/react';
import { STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE } from './hostProperties';

/** All the shell publishes, and all any screen reads. */
export interface WorkspaceRef {
  id: string;
  name: string;
}

export interface WorkspaceState {
  workspace: WorkspaceRef | null;
  loading: boolean;
}

const EMPTY: WorkspaceState = { workspace: null, loading: false };

const WorkspaceContext = createContext<WorkspaceState>(EMPTY);

/** Null `workspace` with `loading` false means: the organization has none. */
export function useWorkspace(): WorkspaceState {
  return useContext(WorkspaceContext);
}

function isWorkspaceRef(value: unknown): value is WorkspaceRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Partial<WorkspaceRef>;
  return typeof ref.id === 'string' && !!ref.id && typeof ref.name === 'string';
}

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const published = useSharedProperty<unknown>(STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE);

  const value: WorkspaceState =
    published === undefined
      ? { workspace: null, loading: true }
      : { workspace: isWorkspaceRef(published) ? published : null, loading: false };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

WorkspaceProvider.displayName = 'WorkspaceProvider';
