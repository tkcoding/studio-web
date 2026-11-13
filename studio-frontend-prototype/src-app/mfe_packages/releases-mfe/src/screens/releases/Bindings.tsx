/**
 * Which profile each environment runs (ADR-0057): the bindings half of the
 * prototype's ProjectEnvironments (environments-screen.tsx at 00828880), as
 * Releases folds it under the ladder. Each environment runs one kubernetes
 * profile the saved description declares; one profile may run in several.
 * Deploy takes the namespace and the image registry from the environment.
 */

import { useEffect, useState } from 'react';
import { Button, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import type { EnvironmentBinding, ProjectTargets } from '../../api/types';
import { declaredProfiles, deployableProfiles, profileLabel, type DeclaredProfile } from '../../model/product-profiles';
import { oneEach } from '../../model/project-deploys';
import { ErrorLine, errText, useApi, useReleases } from './parts';
import styles from './ReleasesScreen.module.css';

function sortBindings(b: EnvironmentBinding[]): EnvironmentBinding[] {
  return [...b].sort((x, y) => x.environment_id.localeCompare(y.environment_id));
}

/** The saved description's profiles, read from its latest revision; the
 *  profiles a new description starts with until it is read, and when the
 *  project has none (the prototype's useDeclaredProfiles). */
function useDeclaredProfiles(): DeclaredProfile[] {
  const { projectId } = useReleases();
  const api = useApi();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .productDescription({ projectId })
      .fetch({ staleTime: 0 })
      .then((d) => live && setText(d.latest?.text ?? null))
      .catch(() => live && setText(null));
    return () => {
      live = false;
    };
  }, [api, projectId]);
  return declaredProfiles(text);
}

/** Keyed by Releases' read: chart values saved on a rung are in the same
 *  bindings, and a stale copy saved here would put the old ones back. */
export function ProjectBindings({ targets, onSaved }: { targets: ProjectTargets; onSaved: () => void }) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const declared = useDeclaredProfiles();
  // An environment runs a profile it can deploy: a cluster, a `kubernetes` one (ADR-0057).
  const offered = deployableProfiles(declared).map((p) => p.id);
  const [bindings, setBindings] = useState<EnvironmentBinding[]>(() => oneEach(targets.bindings));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each environment runs one profile; one profile may run in several (ADR-0057).
  const bound = (environment: string) => bindings.find((b) => b.environment_id === environment)?.profile ?? '';
  const bind = (environment: string, profile: string) => {
    setSaved(false);
    // Values belong to the release in that environment: kept while it stays
    // bound, whichever profile it runs.
    setBindings((all) => {
      const was = all.find((b) => b.environment_id === environment);
      const next = was ? { ...was, profile } : { profile, environment_id: environment };
      return [...all.filter((b) => b.environment_id !== environment), ...(profile ? [next] : [])];
    });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setBindings((await api.saveBindings(projectId).fetch({ items: bindings })).items);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const changed = JSON.stringify(sortBindings(bindings)) !== JSON.stringify(sortBindings(targets.bindings));

  return (
    <div className={styles.stack} data-project-environments>
      <h3 className={styles.subTitle}>{t('bindings_title')}</h3>
      {targets.environments.length === 0 ? (
        <p className={styles.muted}>{t('bindings_none')}</p>
      ) : (
        <>
          <p className={styles.muted}>{t('bindings_hint')}</p>
          <ul className={styles.rows}>
            {targets.environments.map((x) => {
              const env = x.environment;
              const current = bound(env.id);
              return (
                <li key={env.id} className={styles.wrapRow} data-binding-environment={env.name}>
                  <b>{env.name}</b>
                  {env.protected ? ` ${t('protected')}` : ''} {t('runs')}
                  <NativeSelect
                    value={current}
                    onChange={(e) => bind(env.id, e.target.value)}
                    aria-label={t('profile_for', { environment: env.name })}
                  >
                    <NativeSelectOption value="">{t('not_bound')}</NativeSelectOption>
                    {/* A profile bound before that this list does not offer stays shown. */}
                    {[...offered, ...(current && !offered.includes(current) ? [current] : [])].map((p) => (
                      <NativeSelectOption key={p} value={p}>
                        {profileLabel(p, declared)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <span className={styles.muted}>
                    {t('namespace')} <code>{x.namespace}</code>
                    {env.registry && (
                      <>
                        , {t('images_from')} <code>{env.registry}</code>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={styles.row}>
            <Button size="sm" disabled={busy || !changed} onClick={() => void save()} data-bindings-save>
              {t('save')}
            </Button>
            {saved && <span className={styles.muted}>{t('saved')}</span>}
          </div>
        </>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
