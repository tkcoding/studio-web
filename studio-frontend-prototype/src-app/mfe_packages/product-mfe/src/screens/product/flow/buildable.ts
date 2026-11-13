// Copied from the prototype (src/deploy-actions.tsx at 00828880, Releases' file): only this pure function.
import type { DeployEnvironment } from '../../../api/types';

/** The environments a Studio build can push from: a registry prefix and a
 *  login to push with. */
export function buildableEnvironments(environments: readonly DeployEnvironment[]): DeployEnvironment[] {
  return environments.filter(
    (e) => (e.kind === 'research' && !!e.research_project) || (e.registry.includes('/') && !!e.registry_connection_id)
  );
}
