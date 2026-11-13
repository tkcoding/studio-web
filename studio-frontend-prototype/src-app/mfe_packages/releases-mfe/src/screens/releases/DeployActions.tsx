/**
 * What a project does in one environment (ADR-0048), the prototype's
 * deploy-actions.tsx (00828880) carried over: deploy a build a pipeline or
 * the IDE published, roll back to the one before, take the release out;
 * decide a deploy that waits for an administrator; previews (ADR-0055); the
 * release's configuration there (chart values, secrets); a rung's place. The
 * rules are in `project-deploys.ts`; the server checks every one of them again.
 */

import { useEffect, useState } from 'react';
import { Badge, Button, Input, NativeSelect, NativeSelectOption, Textarea } from '@gears-frontx/ui-kit';
import { openScreen } from '@constructor-studio/mfe-shared';
import type {
  ConfigSecret,
  Connection,
  Deployment,
  DeploymentRequest,
  DeployEnvironment,
  EnvironmentBinding,
} from '../../api/types';
import type { IdeBuild } from '../../model/builds';
import { STATE_LABELS, shortCommit, stateTone } from '../../model/environments';
import {
  deployableBuilds,
  expiresIn,
  isSecretKey,
  lifetimeLabel,
  livePreviews,
  parseValues,
  previewLifetimes,
  previewNameFor,
  promotionGap,
  rollbackTarget,
  runsNow,
  valuesText,
} from '../../model/project-deploys';
import type { LadderStep } from '../../model/releases';
import {
  Confirm,
  ErrorLine,
  STATE_BADGE,
  errText,
  personLabel,
  relTime,
  useApi,
  usePeople,
  useReleases,
} from './parts';
import styles from './ReleasesScreen.module.css';

/** Whether an environment is a Constructor Research one (ADR-0049). */
export function isResearch(e: Pick<DeployEnvironment, 'kind'>): boolean {
  return e.kind === 'research';
}

/** Ask the server for a deploy, and say what it answered: queued, or
 *  waiting for an administrator. One for every place a deploy is asked. */
export function useDeployRequest(onChanged: (message: string) => void) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (body: DeploymentRequest, what: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.createDeployment(projectId).fetch(body);
      onChanged(t(d.state === 'awaiting_approval' ? 'asked_waits' : 'asked_queued', { what }));
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, ask };
}

/** Deploy one published build to an environment the project may deploy to:
 *  the action under a build of Releases' builds. */
export function DeployBuildTo({
  build,
  environments,
  deployments,
  onChanged,
}: {
  build: IdeBuild;
  environments: DeployEnvironment[];
  deployments: Deployment[];
  onChanged: (message: string) => void;
}) {
  const { t } = useReleases();
  // Only where this build can go: a Research environment runs only what
  // Research built, the others only a published chart -- the same rule the
  // ladder picks builds by, so the two never offer different things.
  const takers = environments.filter((e) => deployableBuilds([build], e).length > 0);
  const [envId, setEnvId] = useState(takers[0]?.id ?? '');
  const { busy, error, ask } = useDeployRequest(onChanged);
  const envName = (id: string) => environments.find((e) => e.id === id)?.name ?? id;
  const env = takers.find((e) => e.id === envId);
  const gap = env ? promotionGap(env, build, deployments, envName) : null;
  if (takers.length === 0) return null;
  return (
    <div className={styles.row} data-deploy-build-to>
      <NativeSelect value={envId} onChange={(e) => setEnvId(e.target.value)} aria-label={t('environment')}>
        {takers.map((e) => (
          <NativeSelectOption key={e.id} value={e.id}>
            {e.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        size="sm"
        disabled={busy || !env || !!gap}
        title={gap ?? undefined}
        onClick={() =>
          env &&
          void ask(
            { environment_id: env.id, build: build.buildId },
            t('what_deploy_to', { version: build.chartVersion ?? build.buildId, environment: env.name })
          )
        }
      >
        {t('deploy')}
      </Button>
      {gap && <span className={styles.warn}>{gap}</span>}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

/** Deploy a build, roll back, uninstall: one environment's actions, with the
 *  deploys there that wait for a decision. */
export function EnvironmentActions({
  env,
  latest,
  deployments,
  builds,
  envName,
  onChanged,
}: {
  env: DeployEnvironment;
  latest: Deployment | undefined;
  deployments: Deployment[];
  builds: IdeBuild[];
  envName: (id: string) => string;
  onChanged: (message: string) => void;
}) {
  const { t, language } = useReleases();
  const [picking, setPicking] = useState(false);
  // The build a preview is being asked for, if any: its name and lifetime
  // are set in a line under it.
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const request = useDeployRequest(onChanged);
  const { busy, error } = request;
  const candidates = deployableBuilds(builds, env);
  const back = rollbackTarget(deployments, env.id);
  const previews = env.kind !== 'research' && !!env.previews;
  // A deploy that waits for a decision is decided before another is asked:
  // a second request would only wait beside it.
  const waiting = deployments.filter((d) => d.environment_id === env.id && d.state === 'awaiting_approval');
  const ask = async (body: DeploymentRequest, what: string) => {
    const ok = await request.ask(body, what);
    if (ok) {
      setPicking(false);
      setPreviewing(null);
      setUninstalling(false);
    }
    return ok;
  };
  return (
    <div className={styles.stack} data-environment-actions={env.name}>
      {waiting.length > 0 && <PendingDecisions waiting={waiting} onChanged={onChanged} />}
      <div className={styles.row}>
        <Button
          size="sm"
          disabled={busy || waiting.length > 0}
          title={waiting.length > 0 ? t('decide_first') : undefined}
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
          data-deploy-pick-open
        >
          {t('deploy_a_build')}
        </Button>
        {back && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={t('rollback_title', { when: relTime(back.requested_at, language) })}
            onClick={() =>
              void ask(
                { environment_id: env.id, redeploy_of: back.id },
                t('what_rollback', { version: back.chart_version ?? back.build ?? t('the_earlier_build') })
              )
            }
            data-deploy-rollback
          >
            {t('roll_back')}
          </Button>
        )}
        {runsNow(latest) && latest && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setUninstalling(true)} data-deploy-uninstall>
            {t('uninstall')}
          </Button>
        )}
      </div>
      {uninstalling && latest && (
        <Confirm
          title={t('uninstall_title', { product: latest.product, environment: env.name })}
          body={t('uninstall_body')}
          confirmLabel={t('uninstall')}
          busy={busy}
          error={error}
          onCancel={() => setUninstalling(false)}
          onConfirm={() =>
            void ask(
              { environment_id: env.id, product: latest.product, profile: latest.profile, action: 'uninstall' },
              t('uninstall')
            )
          }
        />
      )}
      {picking && (
        <div className={styles.pick} data-build-picker>
          {candidates.length === 0 ? (
            isResearch(env) ? (
              <div className={styles.row} data-research-no-build>
                <Badge variant="warning">{t('no_research_build')}</Badge>
              </div>
            ) : (
              <p className={styles.muted}>{t('no_published_chart')}</p>
            )
          ) : (
            <ul className={styles.rows}>
              {candidates.slice(0, 8).map((b) => {
                const gap = promotionGap(env, b, deployments, envName);
                return (
                  <li key={b.id} className={styles.wrapRow}>
                    <div className={styles.grow}>
                      <b>{b.chartVersion ?? b.buildId}</b> <span className={styles.muted}>{b.where}</span>{' '}
                      {b.commit && <code>{shortCommit(b.commit)}</code>}{' '}
                      <span className={styles.muted}>{relTime(b.finishedAt ?? b.startedAt ?? '', language)}</span>
                      {gap && <div className={styles.warn}>{gap}</div>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !!gap}
                      onClick={() =>
                        void ask(
                          { environment_id: env.id, build: b.buildId },
                          t('what_deploy', { version: b.chartVersion ?? b.buildId })
                        )
                      }
                      data-deploy-build={b.buildId}
                    >
                      {t('deploy')}
                    </Button>
                    {previews && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-expanded={previewing === b.buildId}
                        title={t('preview_title', { environment: env.name })}
                        onClick={() => setPreviewing((v) => (v === b.buildId ? null : b.buildId))}
                        data-preview-build={b.buildId}
                      >
                        {t('preview')}
                      </Button>
                    )}
                    {previews && previewing === b.buildId && (
                      <PreviewForm
                        build={b}
                        most={env.previews?.ttl_hours ?? 72}
                        busy={busy}
                        onCancel={() => setPreviewing(null)}
                        onStart={(name, ttl) =>
                          void ask(
                            { environment_id: env.id, build: b.buildId, preview: { name: name || undefined, ttl_hours: ttl } },
                            t('what_preview', { version: b.chartVersion ?? b.buildId, environment: env.name })
                          )
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {error && !uninstalling && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

/** The deploys to one environment that wait for an administrator, decided
 *  where they were asked. Whoever may not decide sees who does. */
function PendingDecisions({ waiting, onChanged }: { waiting: Deployment[]; onChanged: (message: string) => void }) {
  const { t, language, organizationId, projectId } = useReleases();
  const api = useApi();
  const [mayDecide, setMayDecide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const people = usePeople([organizationId, projectId]);
  useEffect(() => {
    if (!organizationId) return;
    let live = true;
    api
      .environments({ organizationId })
      .fetch({ staleTime: 0 })
      .then((r) => live && setMayDecide(r.may_manage))
      .catch(() => live && setMayDecide(false));
    return () => {
      live = false;
    };
  }, [api, organizationId]);
  const decide = async (d: Deployment, action: 'approve' | 'decline') => {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    try {
      await api
        .decideDeployment(organizationId, d.id)
        .fetch(action === 'decline' ? { action, reason: reason.trim() } : { action });
      setDeclining(null);
      setReason('');
      const version = d.chart_version ?? d.build ?? d.product;
      onChanged(t(action === 'approve' ? 'approved' : 'declined', { version, environment: d.environment_name }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.pick} data-deploys-waiting>
      <ul className={styles.rows}>
        {waiting.map((d) => (
          <li key={d.id} className={styles.wrapRow}>
            <div className={styles.grow}>
              <Badge variant="warning">{t('waits_for_decision')}</Badge> <b>{d.chart_version ?? d.build ?? d.product}</b>{' '}
              {d.commit && <code>{shortCommit(d.commit)}</code>}{' '}
              <span className={styles.muted}>
                {t('asked_by', {
                  who: personLabel(d.requested_by, d.requested_by_name, people, t),
                  when: relTime(d.requested_at, language),
                })}
              </span>
            </div>
            {mayDecide ? (
              <>
                <Button size="sm" disabled={busy} onClick={() => void decide(d, 'approve')} data-deploy-approve>
                  {t('approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeclining(declining === d.id ? null : d.id)}
                >
                  {t('decline_open')}
                </Button>
                {declining === d.id && (
                  <>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t('decline_reason')}
                      aria-label={t('reason')}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => void decide(d, 'decline')}
                      data-deploy-decline
                    >
                      {t('decline')}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <span className={styles.muted}>{t('admin_decides')}</span>
            )}
          </li>
        ))}
      </ul>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

/** A preview's name and how long it lives, asked in a line under its build.
 *  The server checks both again: the name's characters, the environment's
 *  most hours. */
function PreviewForm({
  build,
  most,
  busy,
  onStart,
  onCancel,
}: {
  build: IdeBuild;
  most: number;
  busy: boolean;
  onStart: (name: string, ttlHours: number) => void;
  onCancel: () => void;
}) {
  const { t } = useReleases();
  const [name, setName] = useState(() => previewNameFor(build));
  const lifetimes = previewLifetimes(most);
  const [ttl, setTtl] = useState(() => (lifetimes.includes(24) ? 24 : lifetimes[lifetimes.length - 1]));
  const valid = /^[a-z0-9-]{0,20}$/.test(name.trim());
  return (
    <form
      className={styles.formRow}
      data-preview-form={build.buildId}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onStart(name.trim(), ttl);
      }}
    >
      <Input
        aria-label={t('preview_name')}
        value={name}
        maxLength={20}
        placeholder={t('preview_name_placeholder')}
        onChange={(e) => setName(e.target.value.toLowerCase())}
        title={t('preview_name_rule')}
      />
      <NativeSelect aria-label={t('preview_lives')} value={String(ttl)} onChange={(e) => setTtl(Number(e.target.value))}>
        {lifetimes.map((h) => (
          <NativeSelectOption key={h} value={String(h)}>
            {t('preview_for', { lifetime: lifetimeLabel(h) })}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button size="sm" type="submit" disabled={busy || !valid}>
        {t('preview_start')}
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
        {t('cancel')}
      </Button>
      {!valid && <span className={styles.warn}>{t('preview_name_rule')}</span>}
    </form>
  );
}

/** The project's previews in one environment (ADR-0055): each in a namespace
 *  of its own, with its address, until it expires or is removed here. */
export function EnvironmentPreviews({
  env,
  deployments,
  onChanged,
}: {
  env: DeployEnvironment;
  deployments: Deployment[];
  onChanged: (message: string) => void;
}) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Deployment | null>(null);
  if (env.kind === 'research' || !env.previews) return null;
  const live = livePreviews(deployments, env.id);
  const remove = async (d: Deployment) => {
    setBusy(true);
    setError(null);
    try {
      await api.removePreview(projectId, d.id).fetch(undefined);
      setRemoving(null);
      onChanged(t('preview_removing', { name: d.preview?.name ?? '' }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.section} data-environment-previews={env.name}>
      <div className={styles.muted}>
        {t('previews_count', { live: live.length, most: env.previews.max_live ?? 3 })}
        {env.previews.domain ? (
          <>
            {' '}
            · {t('previews_domain')} <code>{env.previews.domain}</code>
          </>
        ) : (
          ` · ${t('previews_no_domain')}`
        )}
      </div>
      {live.length === 0 ? (
        <p className={styles.muted}>{t('no_preview', { environment: env.name })}</p>
      ) : (
        <ul className={styles.rows}>
          {live.map((d) => {
            const p = d.preview!;
            return (
              <li key={d.id} data-preview={p.name}>
                <div className={styles.grow}>
                  <b>{p.name}</b>{' '}
                  <Badge variant={STATE_BADGE[stateTone(d.state)]}>{STATE_LABELS[d.state] ?? d.state}</Badge>{' '}
                  {d.chart_version && <code>{d.chart_version}</code>}{' '}
                  <span className={styles.muted}>
                    <code>{d.namespace}</code> · {expiresIn(p.expires_at)}
                  </span>
                  {p.host && d.state === 'succeeded' && (
                    <div>
                      <a href={`https://${p.host}`} target="_blank" rel="noreferrer" data-preview-url>
                        {p.host} ↗
                      </a>
                    </div>
                  )}
                  {d.state === 'failed' && d.outcome && <div className={styles.warn}>{d.outcome}</div>}
                  {p.removal_error && <div className={styles.warn}>{t('not_removed_yet', { error: p.removal_error })}</div>}
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoving(d)}>
                  {t('remove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {removing && (
        <Confirm
          title={t('preview_remove_title', { name: removing.preview?.name ?? '' })}
          body={t('preview_remove_body', { namespace: removing.namespace })}
          confirmLabel={t('remove')}
          busy={busy}
          error={error}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
      {error && !removing && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

/** The release's configuration in one environment: each bound profile's
 *  chart values, and the secrets every application reads. */
export function EnvironmentConfig({
  env,
  bindings,
  secrets,
  onChanged,
}: {
  env: DeployEnvironment;
  bindings: EnvironmentBinding[];
  secrets: ConfigSecret[];
  onChanged: (message: string) => void;
}) {
  const { t, projectId } = useReleases();
  const api = useApi();
  const mine = bindings.filter((b) => b.environment_id === env.id);
  const keys = secrets.filter((s) => s.environment_id === env.id).map((s) => s.key);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(mine.map((b) => [b.profile, valuesText(b.values)]))
  );
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      onChanged(message);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveValues = (profile: string) => {
    const parsed = parseValues(texts[profile] ?? '');
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    const items = bindings.map((b) =>
      b.environment_id === env.id && b.profile === profile ? { ...b, values: parsed.values } : b
    );
    void run(
      () => api.saveBindings(projectId).fetch({ items }),
      t('values_saved', { profile, environment: env.name })
    );
  };
  return (
    <details className={styles.section} data-environment-config={env.name}>
      <summary className={styles.summary}>
        {t('configuration')} <span className={styles.muted}>· {t.count('secrets_count', keys.length)}</span>
      </summary>
      {mine.length === 0 ? (
        <p className={styles.muted}>{t('bind_first', { environment: env.name })}</p>
      ) : (
        mine.map((b) => (
          <label key={b.profile} className={styles.field}>
            <span>
              {t('chart_values_for')} <code>{b.profile}</code>
            </span>
            <Textarea
              rows={4}
              className={styles.mono}
              value={texts[b.profile] ?? ''}
              placeholder='{ "api-gateway": { "replicaCount": 2 } }'
              onChange={(e) => setTexts((x) => ({ ...x, [b.profile]: e.target.value }))}
            />
            <span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => saveValues(b.profile)} data-save-values>
                {t('save_values')}
              </Button>
            </span>
          </label>
        ))
      )}
      <div className={styles.field}>
        <span>
          {t('secrets')} <span className={styles.muted}>— {t('secrets_where')}</span>{' '}
          {isResearch(env) && (
            <Badge variant="warning" title={t('research_secrets_why')} data-research-limit="secrets">
              {t('research_secrets')}
            </Badge>
          )}
        </span>
        <ul className={styles.rows}>
          {keys.map((k) => (
            <li key={k}>
              <code className={styles.grow}>{k}</code>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api.deleteConfigSecret(projectId, env.id, k).fetch(undefined),
                    t('secret_removed', { key: k, environment: env.name })
                  )
                }
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
        <div className={styles.row}>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="SMTP_PASSWORD"
            aria-label={t('secret_key')}
          />
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('secret_value')}
            aria-label={t('secret_value')}
          />
          <Button
            size="sm"
            disabled={busy || !isSecretKey(key) || !value}
            onClick={() =>
              void run(async () => {
                await api.setConfigSecret(projectId, env.id, key).fetch({ value });
                setKey('');
                setValue('');
              }, t('secret_set', { key, environment: env.name }))
            }
            data-secret-set
          >
            {t('set')}
          </Button>
        </div>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </details>
  );
}

/** A rung of the release ladder: its place as a chip; for a Research
 *  environment also what it still needs -- the member's own sign-in, a build
 *  made in Research -- and its limits as warn chips. Research is a place,
 *  not another process (ADR-0056 §1). */
export function RungPlace({
  step,
  connections,
}: {
  step: Pick<LadderStep, 'environment' | 'deployable'>;
  /** The project's connections; null while they are read. */
  connections: Connection[] | null;
}) {
  const { t, bridge } = useReleases();
  const env = step.environment;
  const research = isResearch(env);
  const place = connections?.find((c) => c.id === env.connection_id);
  // The member's own sign-in to Research, not the one the environment was made with.
  const signedIn = connections?.some((c) => c.provider === 'research' && (c.mine || c.scope === 'personal'));
  return (
    <div className={styles.chips} data-rung-place={research ? 'research' : 'cluster'}>
      <Badge variant={research ? 'info' : 'secondary'} title={t(research ? 'place_research_title' : 'place_cluster_title')}>
        {research
          ? t('place_research', { project: env.research_project ?? '' })
          : t('place_cluster', { label: place?.label ?? t('cluster') })}
      </Badge>
      {research && connections !== null && !signedIn && (
        <button type="button" className={styles.link} onClick={() => openScreen(bridge, '/connections')} data-research-signin>
          {t('research_signin')}
        </button>
      )}
      {research && step.deployable.length === 0 && <Badge variant="warning">{t('no_research_build')}</Badge>}
      {research && (
        <>
          <Badge variant="warning" title={t('research_secrets_why')} data-research-limit="secrets">
            {t('research_secrets')}
          </Badge>
          <Badge variant="warning" title={t('research_previews_why')} data-research-limit="previews">
            {t('research_no_previews')}
          </Badge>
        </>
      )}
    </div>
  );
}
