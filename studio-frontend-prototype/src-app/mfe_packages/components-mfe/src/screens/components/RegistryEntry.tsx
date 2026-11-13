/**
 * One registry entry, opened under its row (the prototype's `EntryDetail`
 * and the parts it is made of): the evidence for a candidate and Declare it,
 * capabilities, owner, category, aliases, merge and deprecation, the
 * contribution to the platform, who uses it, Suggest a description, Ready to
 * leave its project? with Extract, where it was found, and the decisions —
 * the history and the moves its state allows.
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import type {
  RegistryDeclareResult,
  RegistryDecisionInput,
  RegistryEntry,
  RegistryExtractPreview,
  RegistryReadiness,
  RegistrySuggestion,
} from '../../api/types';
import { occurrencePlace } from '../../model/org-gear-repository';
import {
  ACTION_LABEL,
  READINESS_LABEL,
  allowedActions,
  consumerLine,
  consumersLabel,
  declareRefusal,
  decisionLine,
  decisionRefusal,
  decisionTargets,
  deprecationImpact,
  detectedProjects,
  evidenceLines,
  extractPreviewLines,
  extractionLine,
  extractionOpen,
  ownerLabel,
  publicationPending,
  readinessHeadline,
  readinessRefusal,
  spotLabel,
  suggestRefusal,
  suggestionEdit,
  type RegistryAction,
} from '../../model/registry';
import { api, errText, statusOf, useScope } from './common';
import { OutLink } from './parts';
import styles from './ComponentsScreen.module.css';

export interface Person {
  id: string;
  name: string;
}

export function EntryDetail({
  entry: e,
  entries,
  people,
  names,
  onDecided,
  onOpenComponent,
  platformAdmin,
}: {
  entry: RegistryEntry;
  entries: RegistryEntry[];
  people: Person[];
  names: Record<string, string>;
  onDecided: () => void;
  onOpenComponent?: () => void;
  platformAdmin: boolean;
}) {
  const { t } = useScope();
  return (
    <div className={styles.entry} data-registry-entry={e.name}>
      {e.state === 'candidate' && (
        <div data-registry-evidence>
          <b>{t('looks_like_gear', { score: e.score ?? 0 })}</b>
          <ul className={styles.evidence}>
            {evidenceLines(e).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <DeclareCandidate entry={e} onDeclared={onDecided} />
        </div>
      )}
      {e.capabilities.length > 0 && (
        <div>
          <b>{t('capabilities')}:</b> {e.capabilities.join(', ')}
        </div>
      )}
      <div>
        <b>{t('owner')}:</b> {ownerLabel(e.owner) ?? <span className={styles.muted}>{t('nobody_yet')}</span>}
      </div>
      {e.category && (
        <div>
          <b>{t('category')}:</b> {e.category}
        </div>
      )}
      {(e.aliases ?? []).length > 0 && (
        <div>
          <b>{t('also_found_as')}:</b> {(e.aliases ?? []).join(', ')}
        </div>
      )}
      {e.state === 'merged' && e.merged_into && <div>{t('merged_into', { name: e.merged_into })}</div>}
      {e.state === 'deprecated' && (
        <div>
          <b>{t('deprecated')}</b>
          {e.replaced_by ? ` — ${t('use_instead', { name: e.replaced_by })}` : `: ${t('no_longer_chosen')}`}
        </div>
      )}
      {e.state === 'published' && e.version && (
        <div>
          <b>{t('published_version')}:</b> {e.version}
        </div>
      )}
      {e.contribution && (
        <div data-registry-contribution>
          <b>{e.state === 'published' ? t('contributed') : t('contribution_opened')}:</b>{' '}
          {e.contribution.pr_url ? <OutLink href={e.contribution.pr_url}>{e.contribution.pr_url}</OutLink> : <code>{e.contribution.branch}</code>}{' '}
          <span className={styles.sub}>
            — {t.count('files_into', e.contribution.files, { repo: e.contribution.repo, path: e.contribution.path })}
            {e.state !== 'published' && `; ${t('published_once_platform')}`}
          </span>
        </div>
      )}
      {(e.consumers ?? []).length > 0 && (
        <div data-registry-consumers>
          <b>{consumersLabel(e)}:</b> {(e.consumers ?? []).map(consumerLine).join(', ')}
        </div>
      )}
      <SuggestDescription entry={e} onApplied={onDecided} />
      {e.extraction && (
        <div data-registry-extraction>
          <b>{extractionLine(e.extraction)}</b>
          <div className={styles.chips}>
            {e.extraction.gear_pr_url && <OutLink href={e.extraction.gear_pr_url}>{t('pr_into_gear_repo')}</OutLink>}
            {e.extraction.source_pr_url && <OutLink href={e.extraction.source_pr_url}>{t('pr_into_project')}</OutLink>}
          </div>
        </div>
      )}
      <ExtractReadiness entry={e} onChanged={onDecided} />
      <div>
        <b>{t('found_in')}</b>
      </div>
      <ul className={styles.evidence}>
        {e.occurrences.map((o) => (
          <li key={`${o.repo}:${o.path}`}>
            {occurrencePlace(o)} · <code>{o.repo}</code>
            {o.git_ref ? `@${o.git_ref}` : ''} · <code>{o.path}</code> · {o.declared_in}
            {o.commit ? <span className={styles.muted}> · {o.commit.slice(0, 7)}</span> : null}
          </li>
        ))}
      </ul>
      {(e.first_seen || e.last_seen) && (
        <div className={styles.sub}>
          {e.first_seen && t('first_seen', { when: new Date(e.first_seen).toLocaleDateString() })}
          {e.last_seen && ` · ${t('last_read', { when: new Date(e.last_seen).toLocaleString() })}`}
        </div>
      )}
      {onOpenComponent && (
        <Button variant="link" size="sm" onClick={onOpenComponent} data-registry-open>
          {t('open_in_catalogue')} →
        </Button>
      )}
      <RegistryDecisions entry={e} entries={entries} people={people} names={names} onDecided={onDecided} platformAdmin={platformAdmin} />
    </div>
  );
}

/** Declare it (ADR-0041 P3): preview the files a pull request would add, then open it. */
export function DeclareCandidate({
  entry,
  onDeclared,
}: {
  entry: Pick<RegistryEntry, 'name' | 'occurrences'>;
  onDeclared?: () => void;
}) {
  const { org, t } = useScope();
  const [preview, setPreview] = useState<RegistryDeclareResult | null>(null);
  const [done, setDone] = useState<RegistryDeclareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const inProjects = detectedProjects(entry);
  const project = inProjects.length > 1 ? inProjects[0] : undefined;

  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api()
        .declare(org?.id ?? null, entry.name)
        .fetch({ dry_run: dry, project_id: project, description: description.trim() || undefined });
      if (dry) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
        onDeclared?.();
      }
    } catch (cause) {
      setError(declareRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className={styles.block} data-declare-done>
        {t('declare_done', { branch: done.branch, repo: done.repo })}{' '}
        {done.pr_url ? <OutLink href={done.pr_url}>{done.pr_url}</OutLink> : null}
      </div>
    );
  }
  return (
    <div className={styles.block} data-declare-candidate>
      {!preview ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(true)}>
          {busy ? t('preparing') : t('declare_it')}
        </Button>
      ) : (
        <div className={styles.stack}>
          <div>
            {t('declare_preview', { branch: preview.branch, repo: preview.repo, path: preview.path })}
            {preview.manifest ? ` (${preview.manifest})` : ''}
          </div>
          {preview.files.map((f) => (
            <div key={f.path}>
              <code>{f.path}</code>
              <pre className={styles.pre}>{f.content}</pre>
            </div>
          ))}
          <label className={styles.formRow}>
            <b>{t('description')}</b>
            <Input value={description} onChange={(ev) => setDescription(ev.target.value)} placeholder={t('description_placeholder')} />
          </label>
          <span className={styles.row}>
            <Button size="sm" disabled={busy} onClick={() => void run(false)}>
              {busy ? t('opening') : t('open_pr')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>
              {t('preview_again')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(null)}>
              {t('cancel')}
            </Button>
          </span>
        </div>
      )}
      {error && (
        <div className={styles.error} data-declare-error>
          {error}
        </div>
      )}
    </div>
  );
}

/** An entry's decisions history and the moves its state allows. */
export function RegistryDecisions({
  entry: e,
  entries,
  people,
  names,
  onDecided,
  platformAdmin,
}: {
  entry: RegistryEntry;
  entries: RegistryEntry[];
  people: Person[];
  names: Record<string, string>;
  onDecided: () => void;
  platformAdmin: boolean;
}) {
  const { org, t } = useScope();
  const orgId = org?.id ?? null;
  const [detail, setDetail] = useState<RegistryEntry | null>(null);
  const [form, setForm] = useState<RegistryAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownerKind, setOwnerKind] = useState<'person' | 'team'>(e.owner?.kind ?? 'person');
  const [ownerId, setOwnerId] = useState(e.owner?.id ?? '');
  const [ownerName, setOwnerName] = useState(e.owner?.name ?? '');
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const [version, setVersion] = useState('');
  const [kind, setKind] = useState(e.kind);
  const [category, setCategory] = useState(e.category ?? '');
  const [capabilities, setCapabilities] = useState(e.capabilities.join(', '));
  const [description, setDescription] = useState(e.description ?? '');

  useEffect(() => {
    let live = true;
    api()
      .registryEntry({ org: orgId, name: e.name })
      .fetch({ staleTime: 0 })
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch(() => {
        if (live) setDetail(null);
      });
    return () => {
      live = false;
    };
  }, [orgId, e.name, e.state]);

  const targets = useMemo(() => decisionTargets(entries, e.name), [entries, e.name]);
  const decisions = detail?.decisions ?? [];
  // Asked of the platform and not answered yet (ADR-0042 §4).
  const requested = publicationPending(decisions);

  const submit = async () => {
    if (!form) return;
    const input: RegistryDecisionInput = { action: form };
    const owner = () =>
      ownerName.trim() ? { kind: ownerKind, id: ownerKind === 'person' ? ownerId || null : null, name: ownerName.trim() } : undefined;
    if (form === 'register' || form === 'edit') {
      input.owner = owner();
      if (form === 'edit') {
        input.kind = kind.trim() || undefined;
        input.category = category.trim() || null;
        input.description = description.trim() || null;
      } else if (category.trim()) {
        input.category = category.trim();
      }
      input.capabilities = capabilities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
    }
    if (reason.trim()) input.reason = reason.trim();
    if (form === 'deprecate' && target) input.replaced_by = target;
    if (form === 'merge') input.merge_into = target;
    if ((form === 'mark_published' || form === 'request_publication') && version.trim()) input.version = version.trim();
    setBusy(true);
    setError(null);
    try {
      setDetail(await api().decide(orgId, e.name).fetch(input));
      setForm(null);
      setReason('');
      setTarget('');
      onDecided();
    } catch (cause) {
      setError(decisionRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    form === 'register' ? ownerName.trim() !== '' : form === 'reject' ? reason.trim() !== '' : form === 'merge' ? target !== '' : true;

  const targetSelect = (label: string, required: boolean) => (
    <label className={styles.formRow}>
      <b>{label}</b>
      <NativeSelect value={target} onChange={(ev) => setTarget(ev.target.value)} aria-label={label}>
        <NativeSelectOption value="">{required ? t('choose_entry') : t('none')}</NativeSelectOption>
        {targets.map((x) => (
          <NativeSelectOption key={x} value={x}>
            {x}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );

  return (
    <div className={styles.decisions} data-registry-decisions>
      <div className={styles.row}>
        <b>{t('decide')}</b>
        {allowedActions(e.state, { curator: platformAdmin, publicationPending: requested || !!e.contribution }).map((a) => (
          <Button
            key={a}
            size="sm"
            variant={form === a ? 'default' : 'outline'}
            onClick={() => {
              setError(null);
              setForm(form === a ? null : a);
            }}
            disabled={busy}
            data-registry-action={a}
          >
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
      {requested && !e.contribution && (
        <div className={styles.hint} data-registry-publication-requested>
          {t('publication_requested_note')}
        </div>
      )}
      {form && (
        <div className={styles.form}>
          {(form === 'register' || form === 'edit') && (
            <div className={styles.formRow}>
              <b>{t('owner')}</b>
              <NativeSelect value={ownerKind} onChange={(ev) => setOwnerKind(ev.target.value as 'person' | 'team')} aria-label={t('owner_kind')}>
                <NativeSelectOption value="person">{t('person')}</NativeSelectOption>
                <NativeSelectOption value="team">{t('team')}</NativeSelectOption>
              </NativeSelect>
              {ownerKind === 'person' && people.length > 0 ? (
                <NativeSelect
                  value={ownerId}
                  aria-label={t('owner')}
                  onChange={(ev) => {
                    setOwnerId(ev.target.value);
                    setOwnerName(people.find((p) => p.id === ev.target.value)?.name ?? '');
                  }}
                >
                  <NativeSelectOption value="">{t('choose_person')}</NativeSelectOption>
                  {people.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  placeholder={ownerKind === 'person' ? t('person_name') : t('team_name')}
                  value={ownerName}
                  onChange={(ev) => {
                    setOwnerName(ev.target.value);
                    setOwnerId('');
                  }}
                  aria-label={t('owner_name')}
                />
              )}
            </div>
          )}
          {form === 'edit' && (
            <label className={styles.formRow}>
              <b>{t('kind')}</b>
              <Input value={kind} onChange={(ev) => setKind(ev.target.value)} aria-label={t('kind')} />
            </label>
          )}
          {(form === 'register' || form === 'edit') && (
            <>
              <label className={styles.formRow}>
                <b>{t('category')}</b>
                <Input value={category} onChange={(ev) => setCategory(ev.target.value)} aria-label={t('category')} />
              </label>
              <label className={styles.formRow}>
                <b>{t('capabilities')}</b>
                <Input
                  value={capabilities}
                  onChange={(ev) => setCapabilities(ev.target.value)}
                  placeholder={t('capabilities_placeholder')}
                  aria-label={t('capabilities')}
                />
              </label>
            </>
          )}
          {form === 'edit' && (
            <label className={styles.formRow}>
              <b>{t('description')}</b>
              <Input value={description} onChange={(ev) => setDescription(ev.target.value)} aria-label={t('description')} />
            </label>
          )}
          {form === 'deprecate' && targetSelect(t('replaced_by'), false)}
          {form === 'deprecate' && deprecationImpact(detail ?? e) && (
            <div className={styles.hint} data-registry-deprecate-impact>
              {deprecationImpact(detail ?? e)}
            </div>
          )}
          {form === 'merge' && targetSelect(t('merge_into'), true)}
          {form === 'request_publication' && (
            <div className={styles.hint} data-registry-publication-explain>
              {t('request_publication_explain')}
            </div>
          )}
          {(form === 'request_publication' || form === 'mark_published') && (
            <label className={styles.formRow}>
              <b>{t('version')}</b>
              <Input
                value={version}
                onChange={(ev) => setVersion(ev.target.value)}
                placeholder={form === 'mark_published' ? t('version_placeholder') : t('version_optional')}
                aria-label={t('version')}
              />
            </label>
          )}
          <label className={styles.formRow}>
            <b>{form === 'reject' ? t('reason') : t('why')}</b>
            <Input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              placeholder={form === 'reject' ? t('reject_reason_placeholder') : t('optional')}
              aria-label={t('reason')}
            />
          </label>
          <span className={styles.row}>
            <Button size="sm" disabled={busy || !ready} onClick={() => void submit()} data-registry-submit>
              {busy ? t('saving') : ACTION_LABEL[form].replace('…', '')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>
              {t('cancel')}
            </Button>
          </span>
        </div>
      )}
      {error && (
        <div className={styles.error} data-registry-decision-error>
          {error}
        </div>
      )}
      <div>
        <b>{t('decisions')}</b>
      </div>
      {decisions.length === 0 ? (
        <div className={styles.muted}>{e.state === 'declared' ? t('no_decisions_declared') : t('no_decisions')}</div>
      ) : (
        <ul className={styles.evidence}>
          {decisions.map((d, i) => (
            <li key={`${d.at}:${i}`}>
              <span className={styles.muted}>{new Date(d.at).toLocaleString()}</span> · {decisionLine(d, names)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Suggest (ADR-0041 P4): a model's description, category and capabilities, on the caller's own key. */
function SuggestDescription({ entry: e, onApplied }: { entry: RegistryEntry; onApplied: () => void }) {
  const { org, t } = useScope();
  const orgId = org?.id ?? null;
  const [suggestion, setSuggestion] = useState<RegistrySuggestion | null>(e.suggestion ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setApplied(false);
    try {
      setSuggestion(await api().suggest(orgId, e.name).fetch(undefined));
    } catch (cause) {
      setError(suggestRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!suggestion) return;
    setBusy(true);
    setError(null);
    try {
      await api().decide(orgId, e.name).fetch(suggestionEdit(suggestion));
      setApplied(true);
      onApplied();
    } catch (cause) {
      setError(decisionRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.block} data-registry-suggest>
      <span className={styles.row}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void ask()}>
          {busy && !suggestion ? t('asking') : suggestion ? t('suggest_again') : t('suggest')}
        </Button>
        <span className={styles.sub}>{t('suggest_hint')}</span>
      </span>
      {suggestion && (
        <div className={styles.well} data-registry-suggestion>
          <div>
            <b>{t('suggested')}</b> <span className={styles.muted}>{t('by_model', { model: suggestion.model })}</span>
          </div>
          {suggestion.description && <div>{suggestion.description}</div>}
          <div>
            <b>{t('category')}:</b> {suggestion.category ?? <span className={styles.muted}>{t('none_fits')}</span>}
          </div>
          <div>
            <b>{t('capabilities')}:</b>{' '}
            {suggestion.capabilities.length ? suggestion.capabilities.join(', ') : <span className={styles.muted}>{t('none_fits')}</span>}
          </div>
          {applied ? (
            <div data-registry-suggestion-applied>{t('applied')}</div>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void apply()}>
              {t('apply')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <div className={styles.error} data-registry-suggest-error>
          {error}
        </div>
      )}
    </div>
  );
}

/** Ready to leave its project? (ADR-0044 §1): the checks before Extract, then Extract itself. */
function ExtractReadiness({ entry: e, onChanged }: { entry: RegistryEntry; onChanged: () => void }) {
  const { org, t } = useScope();
  const orgId = org?.id ?? null;
  const [result, setResult] = useState<RegistryReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RegistryExtractPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const open = extractionOpen(e);

  const act = async (input: RegistryDecisionInput, after: (entry: RegistryEntry) => void) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      after(await api().decide(orgId, e.name).fetch(input));
    } catch (cause) {
      setError(decisionRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };
  const extract = (dryRun: boolean) =>
    act({ action: 'extract', ...(dryRun ? { dry_run: true } : {}) }, (after) => {
      if (dryRun) setPreview(after.extract_preview ?? null);
      else {
        setPreview(null);
        setDone(after.extraction ? extractionLine(after.extraction) : t('extraction_opened'));
        onChanged();
      }
    });
  const complete = () =>
    act({ action: 'complete_extraction' }, (after) => {
      setDone(after.extraction ? extractionLine(after.extraction) : t('extracted'));
      onChanged();
    });

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api().registryReadiness({ org: orgId, name: e.name }).fetch({ staleTime: 0 }));
    } catch (cause) {
      setError(readinessRefusal(statusOf(cause), errText(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.block} data-registry-readiness>
      <span className={styles.row}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void check()}>
          {busy ? t('checking') : result ? t('check_again') : t('ready_to_leave')}
        </Button>
        <span className={styles.sub}>{t('readiness_hint')}</span>
      </span>
      {error && (
        <div className={styles.error} data-registry-readiness-error>
          {error}
        </div>
      )}
      {result && (
        <div className={styles.well}>
          <div data-registry-readiness-headline>
            <b>{readinessHeadline(result)}</b>
          </div>
          <div className={styles.sub}>
            {result.kind === 'crate' ? t('the_crate') : t('the_module')} <code>{result.module_path ?? result.path}</code>
            {' · '}
            {t.count('files_in', result.files, { repo: result.repo })}
            {result.project_name ? ` (${result.project_name})` : ''}
            {result.outside_read < result.outside_total &&
              ` · ${t('outside_read', { read: result.outside_read, total: result.outside_total })}`}
          </div>
          <ul className={styles.evidence}>
            {result.checks.map((c) => (
              <li key={c.key} data-readiness-check={c.key}>
                <Badge variant={c.ok ? 'success' : c.blocks ? 'danger' : 'warning'}>
                  {c.ok ? t('check_ok') : c.blocks ? t('check_blocks') : t('check_look')}
                </Badge>{' '}
                <b>{READINESS_LABEL[c.key] ?? c.key}:</b> {c.summary}
                {c.spots.length > 0 && (
                  <ul className={styles.evidence}>
                    {c.spots.map((s, i) => (
                      <li key={`${s.path}:${s.line ?? ''}:${i}`}>
                        <code>{spotLabel(s)}</code>
                        {s.text ? <span className={styles.muted}> {s.text}</span> : null}
                      </li>
                    ))}
                    {c.more > 0 && <li className={styles.muted}>{t('and_more', { count: c.more })}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {result.dependencies.length > 0 && (
            <div className={styles.sub}>
              <b>{t('cargo_would_list')}</b>{' '}
              {result.dependencies.map((d) => (d.spec ? d.name : `${d.name} (${t('not_in_crate')})`)).join(', ')}
            </div>
          )}
          {result.ready && e.state === 'registered' && !open && (
            <div className={styles.row} data-registry-extract>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void extract(true)}>
                {preview ? t('preview_again') : t('extract')}
              </Button>
              <span className={styles.sub}>{t('extract_hint')}</span>
            </div>
          )}
        </div>
      )}
      {preview && (
        <div className={styles.well} data-registry-extract-preview>
          {extractPreviewLines(preview).map((l) => (
            <div key={l}>{l}</div>
          ))}
          {preview.manifest && <pre className={styles.pre}>{preview.manifest}</pre>}
          <Button size="sm" disabled={busy} onClick={() => void extract(false)}>
            {t('open_both_prs')}
          </Button>
        </div>
      )}
      {open && e.state === 'registered' && (
        <div className={styles.row} data-registry-extract-complete>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void complete()}>
            {ACTION_LABEL.complete_extraction}
          </Button>
          <span className={styles.sub}>{t('complete_hint')}</span>
        </div>
      )}
      {done && (
        <div className={styles.hint} data-registry-extract-done>
          {done}
        </div>
      )}
    </div>
  );
}
