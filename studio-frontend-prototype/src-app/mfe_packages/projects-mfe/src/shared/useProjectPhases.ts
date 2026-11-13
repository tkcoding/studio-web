/**
 * The organization's projects' phases (the built-in Project lifecycle kit,
 * `GET /studio-kits/v1/project-phases`), by project id. Empty where the kit
 * does not apply to the organization, or while it is read, or when it cannot
 * be: the project list then shows no phase rather than a wrong one.
 */

import { useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import { ProjectPhaseApiService } from '../api/ProjectStatusApiService';

export function useProjectPhases(organizationId: string | null | undefined): Record<string, string> {
  const [result, setResult] = useState<{ organizationId: string; phases: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    let alive = true;
    let read: Promise<{ installed: boolean; items: { project_id: string; phase: string }[] }>;
    try {
      read = apiRegistry.getService(ProjectPhaseApiService).phases({ organizationId }).fetch({ staleTime: 0 });
    } catch {
      return;
    }
    read.then(
      (r) => alive && setResult({ organizationId, phases: r.installed ? Object.fromEntries(r.items.map((i) => [i.project_id, i.phase])) : {} }),
      () => alive && setResult({ organizationId, phases: {} })
    );
    return () => {
      alive = false;
    };
  }, [organizationId]);
  return result && result.organizationId === organizationId ? result.phases : {};
}
