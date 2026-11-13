/**
 * Add or change one of the organization's environments, opened from the place
 * it runs on (ADR-0056 §2). The prototype's EnvironmentForm, ResearchFields
 * and InfraPlacementField (environments-screen.tsx, infra-services-view.tsx at
 * 00828880): a cluster's registry, logins, builds, infra services and
 * namespaces, or a Constructor Research project and its hardware; the
 * database, the environment it takes releases from, previews, how strictly a
 * product is checked, approval and which projects may deploy. The problems
 * under the fields are the model's (environments.ts, English).
 *
 * A project's own environment (ADR-0054) is added from the project's
 * Releases, not here: this form only writes the organization's.
 */

import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from '@gears-frontx/ui-kit';
import type {
  Connection,
  DeployEnvironment,
  DeployEnvironmentInput,
  InfraIngress,
  ResearchHardware,
  ResearchProject,
} from '../../api/types';
import {
  DEFAULT_BUILD_NAMESPACE,
  DEFAULT_NAMESPACE_PATTERN,
  codedWarnings,
  emptyEnvironment,
  environmentInput,
  environmentProblems,
  namespaceFor,
  type EnvironmentField,
} from '../../model/environments';
import { parseShared, placementText, sharedAllowed, sharedText } from '../../model/infra-services';
import { AddCluster, AddRegistry } from './AddPlace';
import { errText, useApi, useInfra } from './parts';
import styles from './InfrastructureScreen.module.css';

/** The cluster select's "connect a new one" entry. */
const NEW_CLUSTER = '__new_cluster__';

type Setter = <K extends keyof DeployEnvironmentInput>(k: K, v: DeployEnvironmentInput[K]) => void;

/** A project the environment may be limited to. */
export interface ProjectRef {
  id: string;
  name: string;
}

function FieldError({ text }: { text: string | null }) {
  return text ? <span className={styles.fieldError}>{text}</span> : null;
}

/** A Research environment's place: the member's own Research sign-in that
 *  lists the projects, one of its projects and, optionally, a hardware
 *  configuration, as the integration service lists them (ADR-0049 §2). Typed
 *  by hand when Research cannot be asked. */
function ResearchFields({
  input,
  researches,
  fixed,
  set,
  shown,
}: {
  input: DeployEnvironmentInput;
  researches: Connection[];
  /** Opened from its place: the connection is that one, not asked again. */
  fixed: boolean;
  set: Setter;
  shown: (f: EnvironmentField) => string | null;
}) {
  const { t, org } = useInfra();
  const api = useApi();
  const connection = input.connection_id;
  const project = input.research_project ?? '';
  // What Research answered, for the connection (and project) it was asked about:
  // another connection is another read, so a stale answer is never shown.
  const [listed, setListed] = useState<{ connection: string; projects: ResearchProject[]; unreachable: string | null } | null>(
    null
  );
  const [hardwareRead, setHardwareRead] = useState<{ key: string; items: ResearchHardware[] } | null>(null);
  useEffect(() => {
    if (!connection) return;
    let live = true;
    api
      .researchProjects({ organizationId: org.id, connectionId: connection })
      .fetch({ staleTime: 0 })
      .then((r) => live && setListed({ connection, projects: r.items, unreachable: null }))
      .catch((e: unknown) => live && setListed({ connection, projects: [], unreachable: errText(e) }));
    return () => {
      live = false;
    };
  }, [api, org.id, connection]);
  const current = listed?.connection === connection ? listed : null;
  const projects = current?.projects ?? null;
  const unreachable = current?.unreachable ?? null;
  const hardwareKey = `${connection}/${project}`;
  useEffect(() => {
    if (!connection || !project || unreachable) return;
    let live = true;
    api
      .researchHardware({ organizationId: org.id, connectionId: connection, project })
      .fetch({ staleTime: 0 })
      .then((r) => live && setHardwareRead({ key: `${connection}/${project}`, items: r.items }))
      .catch(() => live && setHardwareRead({ key: `${connection}/${project}`, items: [] }));
    return () => {
      live = false;
    };
  }, [api, org.id, connection, project, unreachable]);
  const hardware = hardwareRead?.key === hardwareKey ? hardwareRead.items : null;
  const typed = unreachable !== null || (projects !== null && projects.length === 0);
  return (
    <>
      {!fixed && (
        <label className={styles.field}>
          {t('research_connection')}
          <NativeSelect
            value={connection}
            onChange={(e) => set('connection_id', e.target.value)}
            aria-label={t('research_connection')}
            aria-invalid={shown('connection_id') ? true : undefined}
            data-research-connection
          >
            <NativeSelectOption value="">
              {researches.length === 0 ? t('research_none') : t('research_choose')}
            </NativeSelectOption>
            {researches.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className={styles.muted}>{t('research_connection_hint')}</span>
          <FieldError text={shown('connection_id')} />
        </label>
      )}
      {connection && (
        <label className={styles.field}>
          {t('research_project')}
          {typed ? (
            <Input
              value={project}
              onChange={(e) => set('research_project', e.target.value)}
              placeholder={t('research_project_placeholder')}
              aria-label={t('research_project')}
              aria-invalid={shown('research_project') ? true : undefined}
              data-research-project
            />
          ) : (
            <NativeSelect
              value={project}
              onChange={(e) => {
                set('research_project', e.target.value);
                set('research_hardware', null);
              }}
              aria-label={t('research_project')}
              aria-invalid={shown('research_project') ? true : undefined}
              data-research-project
            >
              <NativeSelectOption value="">
                {projects === null ? t('research_asking') : t('research_project_choose')}
              </NativeSelectOption>
              {(projects ?? []).map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name || p.id}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <span className={styles.muted}>
            {t('research_project_hint')} <code>{'{project}-' + (input.name || 'env')}</code>.
          </span>
          {unreachable && <span className={styles.hint}>{t('research_unreachable', { error: unreachable })}</span>}
          <FieldError text={shown('research_project')} />
        </label>
      )}
      {connection && project && (
        <label className={styles.field}>
          {t('research_hardware')}
          {hardware && hardware.length > 0 ? (
            <NativeSelect
              value={input.research_hardware ?? ''}
              onChange={(e) => set('research_hardware', e.target.value || null)}
              aria-label={t('research_hardware')}
              data-research-hardware
            >
              <NativeSelectOption value="">{t('research_default')}</NativeSelectOption>
              {hardware.map((h) => (
                <NativeSelectOption key={h.id} value={h.id}>
                  {h.name || h.id}
                  {h.trial ? ` — ${t('research_trial')}` : ''}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              value={input.research_hardware ?? ''}
              onChange={(e) => set('research_hardware', e.target.value || null)}
              placeholder={t('research_default')}
              aria-label={t('research_hardware')}
              data-research-hardware
            />
          )}
        </label>
      )}
    </>
  );
}

/** Where a product's infra services run here (ADR-0064 §3), and the Ingress
 *  a service placed with the product is reached through. */
function InfraPlacementField({ input, set }: { input: DeployEnvironmentInput; set: Setter }) {
  const { t } = useInfra();
  const placement = input.infra?.placement ?? 'with_product';
  const allowed = sharedAllowed(input);
  const [text, setText] = useState(() => sharedText(input.infra?.shared ?? []));
  const ingress = input.infra?.ingress ?? null;
  const [notes, setNotes] = useState(() =>
    Object.entries(ingress?.annotations ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  );
  const setIngress = (patch: Partial<InfraIngress>) =>
    set('infra', {
      placement,
      shared: input.infra?.shared ?? [],
      ingress: { ...(ingress ?? {}), ...patch },
    });
  return (
    <details className={styles.advanced} open={placement === 'shared'} data-environment-infra>
      <summary>
        {t('infra_title')}
        <span className={styles.muted}> · {placementText(input.infra)}</span>
      </summary>
      <label className={styles.field}>
        {t('infra_where')}
        <NativeSelect
          value={placement}
          onChange={(e) =>
            set(
              'infra',
              e.target.value === 'shared'
                ? { placement: 'shared', shared: parseShared(text), ingress }
                : { placement: 'with_product', shared: [], ingress }
            )
          }
          aria-label={t('infra_placement')}
        >
          <NativeSelectOption value="with_product">{t('infra_with_product')}</NativeSelectOption>
          <NativeSelectOption value="shared" disabled={!allowed}>
            {allowed ? t('infra_shared') : t('infra_shared_not_dev')}
          </NativeSelectOption>
        </NativeSelect>
        <span className={styles.hint}>{t('infra_dev_hint')}</span>
      </label>
      {placement === 'shared' && (
        <label className={styles.field}>
          {t('infra_shared_places')}
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              set('infra', { placement: 'shared', shared: parseShared(e.target.value), ingress });
            }}
            placeholder="keycloak @identity oidc.issuer=https://id.acme.example/realms/shop"
          />
          <span className={styles.hint}>{t('infra_shared_hint')}</span>
        </label>
      )}
      {placement === 'with_product' && (
        <div className={styles.field} data-environment-infra-ingress>
          <span>{t('infra_ingress')}</span>
          <span className={styles.row}>
            <Input
              value={ingress?.class ?? ''}
              onChange={(e) => setIngress({ class: e.target.value || null })}
              placeholder={t('infra_ingress_class_placeholder')}
              aria-label={t('infra_ingress_class')}
            />
            <Input
              value={ingress?.tls_secret ?? ''}
              onChange={(e) => setIngress({ tls_secret: e.target.value || null })}
              placeholder={t('infra_tls_placeholder')}
              aria-label={t('infra_tls')}
            />
          </span>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              const annotations: Record<string, string> = {};
              for (const line of e.target.value.split('\n')) {
                const at = line.indexOf('=');
                if (at > 0) annotations[line.slice(0, at).trim()] = line.slice(at + 1).trim();
              }
              setIngress({ annotations });
            }}
            placeholder="cert-manager.io/cluster-issuer=letsencrypt"
            aria-label={t('infra_annotations')}
          />
          <span className={styles.hint}>{t('infra_ingress_hint')}</span>
        </div>
      )}
    </details>
  );
}

/** A labelled checkbox: the kit's Checkbox and its words, one click target. */
export function Check({
  checked,
  onChange,
  children,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <label className={styles.check}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(on) => onChange(on === true)} {...rest} />
      <span>{children}</span>
    </label>
  );
}

/** Add or change one environment. */
export function EnvironmentForm({
  editing,
  others,
  clusters,
  registries,
  researches,
  projects,
  initialCluster,
  onDone,
  onCancel,
  onClusterAdded,
}: {
  editing: DeployEnvironment | null;
  others: DeployEnvironment[];
  clusters: Connection[];
  /** The organization's registry connections (ADR-0048). */
  registries: Connection[];
  /** The caller's own Constructor Research sign-ins (ADR-0049). */
  researches: Connection[];
  projects: ProjectRef[];
  /** The place a new environment runs on: the one whose panel is open. */
  initialCluster?: string;
  onDone: () => void;
  onCancel: () => void;
  onClusterAdded: (c: Connection) => void;
}) {
  const { t, org } = useInfra();
  const api = useApi();
  const [input, setInput] = useState<DeployEnvironmentInput>(() =>
    editing
      ? environmentInput(editing)
      : researches.some((c) => c.id === initialCluster)
        ? { ...emptyEnvironment(), kind: 'research', connection_id: initialCluster ?? '' }
        : { ...emptyEnvironment(), connection_id: initialCluster || (clusters.length === 1 ? clusters[0].id : '') }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingRegistry, setConnectingRegistry] = useState(false);
  // A field says what is wrong once it was touched, or once Add was pressed:
  // a fresh form is not a list of complaints.
  const [touched, setTouched] = useState<Set<EnvironmentField>>(new Set());
  const [tried, setTried] = useState(false);
  const problems = environmentProblems(input, others, editing?.id, registries);
  const problem = Object.values(problems)[0] ?? null;
  const shown = (f: EnvironmentField) => ((tried || touched.has(f)) && problems[f]) || null;
  const touch = (f: EnvironmentField) => setTouched((s) => (s.has(f) ? s : new Set(s).add(f)));
  const set: Setter = (k, v) => {
    setInput((i) => ({ ...i, [k]: v }));
    if (
      k !== 'description' &&
      k !== 'database' &&
      k !== 'protected' &&
      k !== 'database_image' &&
      k !== 'promote_from' &&
      k !== 'strictness' &&
      k !== 'kind' &&
      k !== 'research_hardware'
    )
      touch(k as EnvironmentField);
  };
  const patternIsDefault =
    (input.namespace_pattern ?? '').trim() === '' || input.namespace_pattern === DEFAULT_NAMESPACE_PATTERN;
  const examples = (projects.length > 0 ? projects.slice(0, 3).map((p) => p.name) : ['Studio Web']).map((p) =>
    namespaceFor(input.namespace_pattern ?? '', p, input.name || 'dev')
  );
  const examplesProject = projects[0]?.name ?? 'Studio Web';
  // Typed as text: a list rebuilt on every key would swallow the comma being typed.
  const [namespacesText, setNamespacesText] = useState(() => (input.namespaces ?? []).join(', '));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.updateEnvironment(org.id, editing.id).fetch(input);
      else await api.createEnvironment(org.id).fetch(input);
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const restricted = input.projects != null;
  const research = input.kind === 'research';
  // Added from a place's panel ("Add an environment here"): it runs there. The
  // form does not offer another place, nor Research beside a cluster.
  // Changed: it stays on the place it runs on, which the form names too.
  const place = [...clusters, ...researches].find((c) => c.id === (editing ? editing.connection_id : initialCluster));
  // Switching what runs the products starts its own fields over: a cluster's
  // registry means nothing to Research, and Research's project nothing to a cluster.
  const runOn = (kind: 'kubernetes' | 'research') =>
    setInput((i) => ({
      ...i,
      kind,
      connection_id:
        kind === 'research'
          ? researches.length === 1
            ? researches[0].id
            : ''
          : clusters.length === 1
            ? clusters[0].id
            : '',
      registry: '',
      registry_connection_id: null,
      registry_pull_connection_id: null,
      research_project: null,
      research_hardware: null,
      database: i.database === 'shared' ? 'none' : i.database,
    }));
  const warnings = editing ? codedWarnings(editing.warnings, editing.warning_codes) : [];
  return (
    <Card>
      <CardContent className={styles.cardBody}>
        <form
          className={styles.form}
          data-environment-form
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (!problem) void save();
          }}
        >
          <h3 className={styles.formTitle}>{editing ? t('form_change', { name: editing.name }) : t('form_add')}</h3>
          <label className={styles.field}>
            {t('field_name')}
            <Input
              value={input.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={t('field_name_placeholder')}
              aria-label={t('field_name')}
              aria-invalid={shown('name') ? true : undefined}
            />
            <FieldError text={shown('name')} />
          </label>
          <label className={styles.field}>
            {t('field_description')}
            <Input
              value={input.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={t('optional')}
              aria-label={t('field_description')}
            />
          </label>
          {place ? (
            <div className={styles.field} data-environment-place>
              {t('runs_on')}
              <span>
                <b>{place.label}</b>
                {place.base_url && <code className={styles.muted}> {place.base_url}</code>}
              </span>
              <span className={styles.muted}>
                {research ? t('runs_on_research') : editing ? t('runs_on_cluster') : t('runs_on_added_from')}
              </span>
            </div>
          ) : (
            <label className={styles.field}>
              {t('runs_on')}
              <NativeSelect
                value={research ? 'research' : 'kubernetes'}
                onChange={(e) => runOn(e.target.value as 'kubernetes' | 'research')}
                aria-label={t('runs_on')}
                data-environment-kind
              >
                <NativeSelectOption value="kubernetes">{t('runs_on_kubernetes')}</NativeSelectOption>
                <NativeSelectOption value="research">{t('runs_on_research_option')}</NativeSelectOption>
              </NativeSelect>
            </label>
          )}
          {research && (
            <ResearchFields
              input={input}
              researches={place ? [place] : researches}
              fixed={!!place}
              set={set}
              shown={shown}
            />
          )}
          {!research && (
            <>
              {!place && (
                <label className={styles.field}>
                  {t('field_cluster')}
                  <NativeSelect
                    value={connecting ? NEW_CLUSTER : input.connection_id}
                    onChange={(e) => {
                      if (e.target.value === NEW_CLUSTER) {
                        setConnecting(true);
                        return;
                      }
                      setConnecting(false);
                      set('connection_id', e.target.value);
                    }}
                    aria-label={t('field_cluster')}
                    aria-invalid={shown('connection_id') ? true : undefined}
                  >
                    <NativeSelectOption value="">
                      {clusters.length === 0 ? t('cluster_none') : t('cluster_choose')}
                    </NativeSelectOption>
                    {clusters.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.label} — {c.base_url}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value={NEW_CLUSTER}>{t('cluster_connect')}</NativeSelectOption>
                  </NativeSelect>
                  {!connecting && <FieldError text={shown('connection_id')} />}
                </label>
              )}
              {connecting && (
                <AddCluster
                  onCancel={() => setConnecting(false)}
                  onAdded={(c) => {
                    setConnecting(false);
                    onClusterAdded(c);
                    set('connection_id', c.id);
                  }}
                />
              )}
              <label className={styles.field}>
                {t('field_registry')}
                <Input
                  value={input.registry}
                  onChange={(e) => set('registry', e.target.value)}
                  placeholder={t('field_registry_placeholder')}
                  aria-label={t('field_registry')}
                  aria-invalid={shown('registry') ? true : undefined}
                />
                <FieldError text={shown('registry')} />
              </label>
              <label className={styles.field}>
                {t('field_registry_login')}
                <NativeSelect
                  value={connectingRegistry ? NEW_CLUSTER : (input.registry_connection_id ?? '')}
                  onChange={(e) => {
                    if (e.target.value === NEW_CLUSTER) {
                      setConnectingRegistry(true);
                      return;
                    }
                    setConnectingRegistry(false);
                    set('registry_connection_id', e.target.value || null);
                  }}
                  aria-label={t('field_registry_login')}
                  data-registry-login
                >
                  <NativeSelectOption value="">{t('registry_login_none')}</NativeSelectOption>
                  {registries.map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.label} — {c.base_url}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value={NEW_CLUSTER}>{t('registry_connect')}</NativeSelectOption>
                </NativeSelect>
                <span className={styles.muted}>{t('registry_login_hint')}</span>
              </label>
              {connectingRegistry && (
                <AddRegistry
                  onCancel={() => setConnectingRegistry(false)}
                  onAdded={(c) => {
                    setConnectingRegistry(false);
                    onClusterAdded(c);
                    set('registry_connection_id', c.id);
                    if (!input.registry.trim()) set('registry', new URL(c.base_url).host);
                  }}
                />
              )}
              <label className={styles.field}>
                {t('field_pull_login')}
                <NativeSelect
                  value={input.registry_pull_connection_id ?? ''}
                  onChange={(e) => set('registry_pull_connection_id', e.target.value || null)}
                  aria-label={t('field_pull_login')}
                  data-registry-pull-login
                >
                  <NativeSelectOption value="">{t('pull_login_same')}</NativeSelectOption>
                  {registries
                    .filter((c) => c.id !== input.registry_connection_id)
                    .map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.label} — {c.base_url}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <span className={styles.muted}>{t('pull_login_hint')}</span>
              </label>
              {warnings.length > 0 && (
                <ul className={styles.hintList} data-environment-warnings>
                  {warnings.map((w) => (
                    <li key={w.text} data-warning-code={w.code ?? undefined}>
                      {w.code ? <code>{w.code}</code> : null}
                      {w.code ? ' ' : null}
                      {w.text}
                    </li>
                  ))}
                </ul>
              )}
              <details
                className={styles.advanced}
                open={
                  !!(
                    input.builder_image ||
                    input.build_namespace ||
                    (input.namespaces ?? []).length ||
                    input.allow_broad_registry_token
                  ) || !!(shown('builder_image') || shown('build_namespace') || shown('namespaces'))
                }
                data-environment-builds
              >
                <summary>
                  {t('builds_title')}
                  <span className={styles.muted}>
                    {' · '}
                    {t('builds_in')}{' '}
                    <code>
                      {namespaceFor(input.build_namespace || DEFAULT_BUILD_NAMESPACE, examplesProject, input.name || 'dev')}
                    </code>
                    , {input.builder_image ? t('builds_org_builder') : t('builds_studio_builder')}
                  </span>
                </summary>
                <label className={styles.field}>
                  {t('field_builder_image')}
                  <Input
                    value={input.builder_image ?? ''}
                    onChange={(e) => set('builder_image', e.target.value.trim() || null)}
                    placeholder={t('field_builder_image_placeholder')}
                    aria-label={t('field_builder_image')}
                    aria-invalid={shown('builder_image') ? true : undefined}
                    data-builder-image
                  />
                  <span className={styles.hint}>{t('builder_image_hint')}</span>
                  <FieldError text={shown('builder_image')} />
                </label>
                <label className={styles.field}>
                  {t('field_builder_login')}
                  <NativeSelect
                    value={input.builder_registry_connection_id ?? ''}
                    onChange={(e) => set('builder_registry_connection_id', e.target.value || null)}
                    aria-label={t('field_builder_login')}
                  >
                    <NativeSelectOption value="">{t('builder_login_none')}</NativeSelectOption>
                    {registries.map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.label} — {c.base_url}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className={styles.field}>
                  {t('field_build_namespace')}
                  <Input
                    value={input.build_namespace ?? ''}
                    onChange={(e) => set('build_namespace', e.target.value.trim() || null)}
                    placeholder={DEFAULT_BUILD_NAMESPACE}
                    aria-label={t('field_build_namespace')}
                    aria-invalid={shown('build_namespace') ? true : undefined}
                  />
                  <span className={styles.hint}>{t('build_namespace_hint')}</span>
                  <FieldError text={shown('build_namespace')} />
                </label>
                <label className={styles.field}>
                  {t('field_namespaces')}
                  <Input
                    value={namespacesText}
                    onChange={(e) => {
                      setNamespacesText(e.target.value);
                      const list = e.target.value
                        .split(/[\s,]+/)
                        .map((n) => n.trim())
                        .filter(Boolean);
                      set('namespaces', list.length ? list : null);
                    }}
                    placeholder={t('field_namespaces_placeholder')}
                    aria-label={t('field_namespaces')}
                    aria-invalid={shown('namespaces') ? true : undefined}
                  />
                  <span className={styles.hint}>{t('namespaces_hint')}</span>
                  <FieldError text={shown('namespaces')} />
                </label>
                <Check
                  checked={!!input.allow_broad_registry_token}
                  onChange={(on) => set('allow_broad_registry_token', on)}
                >
                  {t('broad_token')}
                </Check>
              </details>
              <InfraPlacementField input={input} set={set} />
              <details className={styles.advanced} open={!patternIsDefault || !!shown('namespace_pattern')}>
                <summary>
                  {t('namespaces_title')} <code>{examples.join(', ')}</code>
                  <span className={styles.muted}> · {t('namespaces_one_per_project')}</span>
                </summary>
                <label className={styles.field}>
                  {t('field_namespace_pattern')}
                  <Input
                    value={input.namespace_pattern ?? ''}
                    onChange={(e) => set('namespace_pattern', e.target.value)}
                    placeholder={DEFAULT_NAMESPACE_PATTERN}
                    aria-label={t('field_namespace_pattern')}
                    aria-invalid={shown('namespace_pattern') ? true : undefined}
                  />
                  <span className={styles.hint}>
                    {t('namespace_pattern_hint', { project: '{project}', environment: '{environment}' })}
                  </span>
                  <FieldError text={shown('namespace_pattern')} />
                </label>
              </details>
            </>
          )}
          <label className={styles.field}>
            {t('field_database')}
            <NativeSelect
              value={input.database}
              onChange={(e) => set('database', e.target.value as 'none' | 'shared' | 'namespace')}
              aria-label={t('field_database')}
            >
              <NativeSelectOption value="none">
                {research ? t('database_own_research') : t('database_own_cluster')}
              </NativeSelectOption>
              {input.database === 'namespace' && (
                <NativeSelectOption value="namespace">{t('database_namespace')}</NativeSelectOption>
              )}
              {/* A shared server is recorded and deploys get nothing from it
                  (ADR-0048 §7), so a new choice of it is not offered; one
                  recorded before stays, saying so. */}
              {!research && input.database === 'shared' && (
                <NativeSelectOption value="shared">{t('database_shared')}</NativeSelectOption>
              )}
            </NativeSelect>
          </label>
          {input.database !== 'shared' && (
            <label className={styles.field}>
              {t('field_postgres_image')}
              <Input
                value={input.database_image ?? ''}
                onChange={(e) => set('database_image', e.target.value || null)}
                placeholder={t('field_postgres_image_placeholder')}
                aria-label={t('field_postgres_image')}
              />
            </label>
          )}
          <label className={styles.field}>
            {t('field_promote_from')}
            <NativeSelect
              value={input.promote_from ?? ''}
              onChange={(e) => set('promote_from', e.target.value || null)}
              aria-label={t('field_promote_from')}
            >
              <NativeSelectOption value="">{t('promote_anywhere')}</NativeSelectOption>
              {others
                .filter((o) => o.id !== editing?.id)
                .map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {t('promote_only_from', { name: o.name })}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          {!research && (
            <div className={styles.field} data-environment-previews-settings>
              <Check
                checked={!!input.previews}
                onChange={(on) =>
                  set('previews', on ? { domain: '', ingress_class: null, ttl_hours: 72, max_live: 3 } : null)
                }
              >
                {t('previews')}
              </Check>
              {input.previews && (
                <div className={styles.grid}>
                  <label className={styles.field}>
                    {t('preview_domain')}
                    <Input
                      value={input.previews.domain}
                      onChange={(e) => input.previews && set('previews', { ...input.previews, domain: e.target.value })}
                      placeholder={t('preview_domain_placeholder')}
                      aria-label={t('preview_domain')}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('preview_ingress_class')}
                    <Input
                      value={input.previews.ingress_class ?? ''}
                      onChange={(e) =>
                        input.previews && set('previews', { ...input.previews, ingress_class: e.target.value || null })
                      }
                      placeholder={t('preview_ingress_class_placeholder')}
                      aria-label={t('preview_ingress_class')}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('preview_ttl')}
                    <Input
                      type="number"
                      min={1}
                      max={336}
                      value={input.previews.ttl_hours ?? 72}
                      onChange={(e) =>
                        input.previews && set('previews', { ...input.previews, ttl_hours: Number(e.target.value) })
                      }
                      aria-label={t('preview_ttl')}
                    />
                  </label>
                  <label className={styles.field}>
                    {t('preview_max')}
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={input.previews.max_live ?? 3}
                      onChange={(e) =>
                        input.previews && set('previews', { ...input.previews, max_live: Number(e.target.value) })
                      }
                      aria-label={t('preview_max')}
                    />
                  </label>
                </div>
              )}
              <FieldError text={shown('previews')} />
            </div>
          )}
          {!research && (
            <label className={styles.field} data-environment-strictness>
              {t('field_strictness')}
              <NativeSelect
                value={input.strictness ?? ''}
                onChange={(e) =>
                  set('strictness', (e.target.value || null) as DeployEnvironmentInput['strictness'])
                }
                aria-label={t('field_strictness')}
              >
                <NativeSelectOption value="">
                  {input.protected ? t('strictness_default_prod') : t('strictness_default_dev')}
                </NativeSelectOption>
                <NativeSelectOption value="dev">{t('strictness_dev')}</NativeSelectOption>
                <NativeSelectOption value="prod">{t('strictness_prod')}</NativeSelectOption>
              </NativeSelect>
              <span className={styles.muted}>{t('strictness_hint')}</span>
            </label>
          )}
          <Check checked={input.protected} onChange={(on) => set('protected', on)} data-environment-protected>
            {t('protected')}
          </Check>
          <Check checked={!restricted} onChange={(on) => set('projects', on ? null : [])} data-environment-every-project>
            {t('every_project')}
          </Check>
          {restricted && (
            <ul className={styles.projectList}>
              {projects.length === 0 && <li className={styles.hint}>{t('no_projects_found')}</li>}
              {projects.map((p) => (
                <li key={p.id}>
                  <Check
                    checked={input.projects?.includes(p.id) ?? false}
                    onChange={(on) =>
                      set(
                        'projects',
                        on ? [...(input.projects ?? []), p.id] : (input.projects ?? []).filter((id) => id !== p.id)
                      )
                    }
                  >
                    {p.name}
                  </Check>
                </li>
              ))}
            </ul>
          )}
          <FieldError text={shown('projects')} />
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || connecting} data-environment-save>
              {editing ? t('save') : t('add')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
