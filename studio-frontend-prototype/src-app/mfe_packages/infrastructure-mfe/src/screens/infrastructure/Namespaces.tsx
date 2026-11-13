/**
 * Two of Infrastructure's tabs for an organization administrator (ADR-0062),
 * the prototype's namespace-assignments-view.tsx and the organization's half
 * of project-images.tsx's RetentionForm (00828880):
 *
 *   - Namespaces: which namespace each project deploys into in each
 *     environment, and where its builds run -- for a cluster that gives Studio
 *     namespaces rather than letting it create them. The rules are
 *     namespace-assignments.ts.
 *   - Image retention: how long the organization keeps its projects' images,
 *     for every project without a retention of its own.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import type { DeployEnvironment, ImageRetention, NamespaceAssignment } from '../../api/types';
import { retentionProblem, retentionSummary } from '../../model/images';
import {
  assignmentInput,
  assignmentProblem,
  assignmentRows,
  suggestedNamespace,
  type AssignmentInput,
} from '../../model/namespace-assignments';
import type { ProjectRef } from './EnvironmentForm';
import { errText, personLabel, relTime, useApi, useInfra, type PeopleNames } from './parts';
import styles from './InfrastructureScreen.module.css';

export function NamespaceAssignments({
  environments,
  projects,
  people,
}: {
  environments: DeployEnvironment[];
  projects: ProjectRef[];
  people: PeopleNames;
}) {
  const { t, org, language } = useInfra();
  const api = useApi();
  const [items, setItems] = useState<NamespaceAssignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssignmentInput | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    api
      .namespaceAssignments({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setItems([]);
        setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [api, org.id, round]);

  const clusters = environments.filter((e) => e.kind !== 'research');
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const envName = (id: string) => environments.find((e) => e.id === id)?.name ?? id;
  const rows = items ? assignmentRows(items, projectName, envName) : null;
  const problem = editing ? assignmentProblem(editing, environments) : null;
  const env = editing ? environments.find((e) => e.id === editing.environment_id) : undefined;
  const suggestion = editing ? suggestedNamespace(env, projectName(editing.project_id)) : '';

  const save = async () => {
    if (!editing) return;
    setTried(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveNamespaceAssignment(org.id).fetch({
        project_id: editing.project_id,
        environment_id: editing.environment_id,
        namespace: editing.namespace.trim(),
        build_namespace: editing.build_namespace.trim() || null,
      });
      setNotice(
        t('assignment_saved', {
          project: projectName(saved.project_id),
          namespace: saved.namespace,
          environment: envName(saved.environment_id),
        })
      );
      setEditing(null);
      setTried(false);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-namespace-assignments>
      <CardContent className={styles.cardBody}>
        <div className={styles.row}>
          <b>{t('tab_namespaces')}</b>
          <span className={`${styles.muted} ${styles.grow}`}>{t('assignments_hint')}</span>
          {!editing && (
            <Button
              size="sm"
              onClick={() => setEditing(assignmentInput())}
              disabled={clusters.length === 0}
              data-assignment-add
            >
              {t('assignment_add')}
            </Button>
          )}
        </div>
        {notice && <p className={styles.notice}>{notice}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {editing && (
          <form
            className={styles.form}
            data-assignment-form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className={styles.grid}>
              <label className={styles.field}>
                {t('col_project')}
                <NativeSelect
                  value={editing.project_id}
                  onChange={(e) => setEditing({ ...editing, project_id: e.target.value })}
                  aria-label={t('col_project')}
                >
                  <NativeSelectOption value="">{t('pick_project')}</NativeSelectOption>
                  {projects.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className={styles.field}>
                {t('col_environment')}
                <NativeSelect
                  value={editing.environment_id}
                  onChange={(e) => setEditing({ ...editing, environment_id: e.target.value })}
                  aria-label={t('col_environment')}
                >
                  <NativeSelectOption value="">{t('pick_environment')}</NativeSelectOption>
                  {clusters.map((e) => (
                    <NativeSelectOption key={e.id} value={e.id}>
                      {e.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label className={styles.field}>
                {t('col_namespace')}
                {env?.namespaces?.length ? (
                  <NativeSelect
                    value={editing.namespace}
                    onChange={(e) => setEditing({ ...editing, namespace: e.target.value })}
                    aria-label={t('col_namespace')}
                  >
                    <NativeSelectOption value="">{t('pick_given_namespace')}</NativeSelectOption>
                    {env.namespaces.map((n) => (
                      <NativeSelectOption key={n} value={n}>
                        {n}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input
                    value={editing.namespace}
                    placeholder={suggestion || 'studio-web-dev'}
                    onChange={(e) => setEditing({ ...editing, namespace: e.target.value })}
                    aria-label={t('col_namespace')}
                  />
                )}
              </label>
              <label className={styles.field}>
                {t('builds_run_in')}
                <Input
                  value={editing.build_namespace}
                  placeholder={editing.namespace.trim() || t('same_namespace')}
                  onChange={(e) => setEditing({ ...editing, build_namespace: e.target.value })}
                  aria-label={t('builds_run_in')}
                />
              </label>
            </div>
            {suggestion && !editing.namespace && !env?.namespaces?.length && (
              <button
                type="button"
                className={styles.link}
                onClick={() => setEditing({ ...editing, namespace: suggestion })}
              >
                {t('use_suggestion', { namespace: suggestion, environment: env?.name ?? '' })}
              </button>
            )}
            {tried && problem && <span className={styles.fieldError}>{problem}</span>}
            <div className={styles.actions}>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? t('saving') : t('save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(null);
                  setTried(false);
                }}
              >
                {t('cancel')}
              </Button>
            </div>
          </form>
        )}
        {rows === null ? (
          <p className={styles.hint}>{t('loading')}</p>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('no_assignments')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_project')}</TableHead>
                <TableHead>{t('col_environment')}</TableHead>
                <TableHead>{t('col_namespace')}</TableHead>
                <TableHead>{t('col_builds_in')}</TableHead>
                <TableHead>{t('col_assigned_by')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} data-assignment={r.key}>
                  <TableCell>
                    <b>{r.project}</b>
                  </TableCell>
                  <TableCell>{r.environment}</TableCell>
                  <TableCell>
                    <code>{r.namespace}</code>
                  </TableCell>
                  <TableCell>
                    {r.build ? <code>{r.build}</code> : <span className={styles.muted}>{t('the_same')}</span>}
                  </TableCell>
                  <TableCell>
                    <span title={r.at ?? undefined}>
                      {r.assignment.assigned_by === 'studio'
                        ? t('assigned_by_run')
                        : r.assignment.assigned_by
                          ? personLabel(r.assignment.assigned_by, null, people, t)
                          : '—'}
                      {r.at ? <span className={styles.muted}> · {relTime(r.at, language)}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => setEditing(assignmentInput(r.assignment))}
                      data-assignment-change={r.key}
                    >
                      {t('change')}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** The organization's image retention: what every project without its own
 *  follows. The summary and the form's problem are the model's (images.ts). */
export function OrgRetention() {
  const { t, org } = useInfra();
  const api = useApi();
  const [retention, setRetention] = useState<ImageRetention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .imageRetention({ organizationId: org.id })
      .fetch({ staleTime: 0 })
      .then((r) => live && setRetention(r))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api, org.id]);
  return (
    <Card data-org-retention>
      <CardContent className={styles.cardBody}>
        <div className={styles.row}>
          <b>{t('tab_retention')}</b>
          <Badge variant="secondary" data-org-retention-summary>
            {retention ? retentionSummary(retention) : error ? t('not_known') : t('reading')}
          </Badge>
          {saved && <span className={styles.hint}>{t('saved')}</span>}
        </div>
        {error && !retention ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('retention_unreadable')}</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : retention ? (
          <RetentionForm
            retention={retention}
            onSaved={(r) => {
              setRetention(r);
              setSaved(true);
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function RetentionForm({ retention, onSaved }: { retention: ImageRetention; onSaved: (r: ImageRetention) => void }) {
  const { t, org } = useInfra();
  const api = useApi();
  const [keepLast, setKeepLast] = useState(retention.keep_last != null ? String(retention.keep_last) : '');
  const [keepDays, setKeepDays] = useState(retention.keep_days != null ? String(retention.keep_days) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = retentionProblem(keepLast, keepDays);
  return (
    <form
      className={styles.form}
      data-image-retention-form
      onSubmit={async (e) => {
        e.preventDefault();
        if (problem) return;
        setBusy(true);
        setError(null);
        try {
          onSaved(
            await api.saveImageRetention(org.id).fetch({
              keep_last: keepLast.trim() ? Number(keepLast) : null,
              keep_days: keepDays.trim() ? Number(keepDays) : null,
            })
          );
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className={styles.hint}>{t('retention_org_hint')}</p>
      <div className={styles.grid}>
        <label className={styles.field}>
          {t('keep_last')}
          <Input
            type="number"
            min={1}
            max={1000}
            value={keepLast}
            onChange={(e) => setKeepLast(e.target.value)}
            placeholder={t('no_limit')}
            aria-label={t('keep_last')}
          />
        </label>
        <label className={styles.field}>
          {t('keep_days')}
          <Input
            type="number"
            min={1}
            max={3650}
            value={keepDays}
            onChange={(e) => setKeepDays(e.target.value)}
            placeholder={t('no_limit')}
            aria-label={t('keep_days')}
          />
        </label>
      </div>
      <p className={styles.muted}>{t('retention_always')}</p>
      {problem && <span className={styles.fieldError}>{problem}</span>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" size="sm" disabled={busy || !!problem} data-retention-save>
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}
