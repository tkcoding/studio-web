/**
 * Kits in the project's IDE (the old prototype's Project › Kits tab,
 * `kits.tsx` `section="kits"`): which official kits the project asked for, and
 * where `cfs` actually wrote them. Apart from React, so the rules are tested.
 *
 * Two records, never confused: an installation is the project's *intent*
 * (`/studio-kits/v1/projects/{id}/installations`), a materialization is a
 * repository the IDE wrote the kit into. The repository list exists only while
 * the project's IDE session runs: without one the backend answers 503, which is
 * the ordinary state of this page, not an error.
 */

/** One repository this kit was written into (`KitMaterializationDto`). */
export interface KitMaterialization {
  repository_id: string;
  repository_label?: string | null;
  version: string;
  status: 'installed' | 'failed' | string;
  materialized_at: string;
  failure_reason?: string | null;
}

/** The project's request for a kit (`KitInstallationDto`). */
export interface KitInstallation {
  kit_slug: string;
  version: string;
  source: string;
  repository_url: string;
  install_mode: string;
  /** pending | installing | installed | failed */
  status: string;
  requested_by: string;
  requested_at: string;
  /** project | all-repositories */
  scope?: string;
  installed_at?: string | null;
  repository_id?: string | null;
  /** Optional: an older backend answers without it, and that must read as "no detail". */
  materializations?: KitMaterialization[];
  failure_reason?: string | null;
}

/** A repository the running IDE has mounted (`ProjectRepositoryDto`). */
export interface ProjectRepository {
  repository_id: string;
  label: string;
  /** project (the project's own) | source (a checkout below it) */
  kind: string;
  git_mode?: string | null;
}

export type Tone = 'success' | 'destructive' | 'warning' | 'secondary';

/** An installation's state as a badge tone. */
export function statusTone(status: string): Tone {
  if (status === 'installed') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'pending' || status === 'installing') return 'warning';
  return 'secondary';
}

/**
 * Where a kit lands, most specific first: what the person picked, then where
 * this kit was last written (so "Reinstall / update" does not move it), then
 * the project's own repository, then the first one. `undefined` with no
 * session: the request goes without `repository_id` and the IDE picks the
 * project repository itself.
 */
export function targetRepository(
  picked: string | undefined,
  installation: KitInstallation | undefined,
  repositories: readonly ProjectRepository[] | null
): string | undefined {
  return (
    picked ??
    installation?.repository_id ??
    repositories?.find((repository) => repository.kind === 'project')?.repository_id ??
    repositories?.[0]?.repository_id ??
    undefined
  );
}

/**
 * What a repository is called on a materialization: the label recorded when
 * the kit landed (still readable with the IDE closed), else the live one, else
 * its id; the project's own marked as the whole project.
 */
export function repositoryLabel(
  entry: KitMaterialization,
  repositories: readonly ProjectRepository[] | null,
  wholeProject: string
): string {
  const mounted = repositories?.find((repository) => repository.repository_id === entry.repository_id);
  const name = entry.repository_label ?? mounted?.label ?? entry.repository_id;
  return mounted?.kind === 'project' ? `${name} · ${wholeProject}` : name;
}

/**
 * The installations to roll out again now that the IDE reports its
 * repositories: those meant for every repository, not mid-install, and not
 * already reconciled at this version on this visit. Reconciling is idempotent
 * on the server (repositories at the version are skipped), and is what reaches
 * a repository that joined the project after the kit was installed.
 */
export function toReconcile(installations: readonly KitInstallation[], done: ReadonlySet<string>): KitInstallation[] {
  return installations.filter(
    (installation) =>
      installation.scope === 'all-repositories' &&
      installation.status !== 'installing' &&
      !done.has(reconcileKey(installation.kit_slug, installation.version))
  );
}

export const reconcileKey = (slug: string, version: string): string => `${slug}@${version}`;
