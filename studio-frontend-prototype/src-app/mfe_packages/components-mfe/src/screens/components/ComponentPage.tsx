/**
 * A component's page (the prototype's `GearDetail`): drawn against the field
 * schema of the component's TYPE, as the catalogue serves it, on the values
 * the catalogue reconciled. Three views: Filled (the answers, with the health
 * strip, size, quality, responsibility and what changed since the window
 * opened), Empty (every field a question) and Sources (where each field is
 * read from). Then the published versions and the Studio-owned profile.
 *
 * Not carried over yet: the Studio domain model's fields on the gear (ModelFields),
 * delivery activity from Constructor Insight, the architecture diagram and
 * the UML blocks (mermaid).
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger, Textarea } from '@gears-frontx/ui-kit';
import type { CatalogNode, FieldVal } from '../../api/types';
import {
  answeredGroups,
  dateText,
  defaultProfile,
  displayName,
  groupHealth,
  lampOf,
  licenceFromVersions,
  numText,
  parseProfile,
  publishedBy,
  sizeText,
  whenLabel,
  type Field,
  type Group,
  type Lamp,
  type Schema,
  type Values,
} from '../../model/catalogue';
import { annotationNote } from '../../model/component-tiers';
import { fieldTrend, type ComponentSnapshot, type FieldTrend } from '../../model/field-trend';
import { responsibilityOf } from '../../model/responsibility';
import { api, errText, useScope, type Text } from './common';
import { OutLink } from './parts';
import styles from './ComponentsScreen.module.css';

/** The windows "since" compares over (the prototype's activity windows). */
export const WINDOWS = [30, 90, 365] as const;

type View = 'empty' | 'filled' | 'sources';

const LAMP_CLASS: Record<Lamp, string> = {
  good: styles.lampGood,
  watch: styles.lampWatch,
  bad: styles.lampBad,
  grey: styles.lampGrey,
};

function LampDot({ lamp }: { lamp: Lamp | string | undefined | null }) {
  if (!lamp) return null;
  return <span className={`${styles.lamp} ${LAMP_CLASS[lamp as Lamp] ?? styles.lampGrey}`} aria-label={String(lamp)} />;
}

export function ComponentPage({
  gear,
  profile,
  values: given,
  schema,
  baselines,
  days,
  onDays,
  onBack,
  onSaved,
}: {
  gear: CatalogNode;
  /** What the editor writes; the panels read `values`. */
  profile: Record<string, unknown> | undefined;
  /** Reconciled fields, from the gear that owns the precedence. */
  values: Values;
  schema: Schema;
  baselines: { status: 'loading' | 'ready' | 'error'; byName: Map<string, ComponentSnapshot> };
  days: number;
  onDays: (days: number) => void;
  onBack: () => void;
  onSaved: (profile: Record<string, unknown>) => void;
}) {
  const { org, t } = useScope();
  const orgId = org?.id ?? null;
  const name = String(gear.value.name ?? gear.instance_id);
  const schemaFields = useMemo(() => schema.groups.flatMap((g) => g.fields), [schema]);
  const [view, setView] = useState<View>('filled');
  const [versions, setVersions] = useState<CatalogNode[] | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    api()
      .versions({ org: orgId, crate: name })
      .fetch({ staleTime: 0 })
      // Newest first, ordered by the catalogue.
      .then(({ nodes }) => {
        if (live) setVersions(nodes ?? []);
      })
      .catch(() => {
        if (live) setVersions([]);
      });
    return () => {
      live = false;
    };
  }, [orgId, name]);

  const values = useMemo(() => {
    // The one fallback this view alone can make: a gear node from before the
    // parser surfaced `license` has the answer only in its versions.
    const base: Values = { ...given };
    if (!base.licence) {
      const lic = licenceFromVersions(versions);
      if (lic) base.licence = { v: lic, b: lic };
    }
    return base;
  }, [given, versions]);
  const filled = schemaFields.filter((f) => values[f.key]).length;
  const pct = schemaFields.length ? Math.round((filled / schemaFields.length) * 100) : 0;
  const derivable = schemaFields.filter((f) => f.source.class === 'repo' || f.source.class === 'api').length;
  const note = annotationNote(gear);

  return (
    <section className={styles.stack} data-component-page={name}>
      <div className={styles.topbar}>
        <Button variant="ghost" onClick={onBack} data-component-back>
          ← {t('back_to_list')}
        </Button>
        <h1 className={styles.title} title={name}>
          {displayName(name)}
        </h1>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList variant="line" aria-label={t('view')}>
            <TabsTrigger value="empty">{t('view_empty')}</TabsTrigger>
            <TabsTrigger value="filled">{t('view_filled')}</TabsTrigger>
            <TabsTrigger value="sources">{t('view_sources')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className={styles.gauge}>
          <Ring pct={view === 'empty' ? 0 : pct} />
          <span className={styles.sub}>
            {view === 'empty'
              ? t('empty_view_note')
              : t('fields_answered', { filled, total: schemaFields.length, derivable })}
          </span>
        </div>
      </div>

      {gear.value.description && <p className={styles.sub}>{String(gear.value.description)}</p>}

      {view === 'filled' && <HealthStrip values={values} schema={schema} />}
      {view === 'filled' && <Kpis values={values} schema={schema} t={t} />}
      {view === 'filled' && <QualityPanel values={values} t={t} />}
      {view === 'filled' && <ResponsibilityPanel values={values} t={t} />}
      {view === 'filled' && baselines.status === 'ready' && (
        <ChangesPanel trend={fieldTrend(schemaFields, values, baselines.byName.get(name))} days={days} onDays={onDays} t={t} />
      )}

      {schema.groups.length === 0 ? (
        <p className={styles.hint}>{t('no_schema_for_type')}</p>
      ) : (
        <div className={styles.panels}>
          {(view === 'filled'
            ? // The map above is the Responsibility group, laid out by role.
              answeredGroups(schema, values).filter((g) => g.id !== 'responsibility')
            : schema.groups
          ).map((group) => (
            <Panel key={group.id} group={group} values={values} view={view} t={t} />
          ))}
        </div>
      )}

      <Versions name={name} rows={versions} repository={gear.value.repository ?? undefined} t={t} />

      {note && <p className={styles.hint}>{note}</p>}
      <div className={styles.row}>
        <Button variant="outline" onClick={() => setEditing((e) => !e)} data-component-edit>
          {editing ? t('close_editor') : note ? t('edit_annotation') : t('edit_profile')}
        </Button>
        {gear.value.repository && <OutLink href={String(gear.value.repository)}>{t('repository')}</OutLink>}
        <OutLink href={`https://crates.io/crates/${encodeURIComponent(name)}`}>crates.io</OutLink>
      </div>
      {editing && <ProfileEditor name={name} profile={profile} onSaved={onSaved} t={t} />}
    </section>
  );
}

/** How many graded fields got worse and better since the window opened. */
export function TrendMark({ trend, t }: { trend: FieldTrend | undefined; t: Text }) {
  if (!trend || trend.better + trend.worse === 0) return null;
  return (
    <span title={t('trend_title', { since: trend.since })}>
      {trend.worse > 0 && <span className={styles.worse}>▼ {t('n_worse', { count: trend.worse })}</span>}
      {trend.worse > 0 && trend.better > 0 && ' · '}
      {trend.better > 0 && <span className={styles.better}>▲ {t('n_better', { count: trend.better })}</span>}
    </span>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className={styles.ring}>
      <svg width={40} height={40} aria-hidden>
        <circle cx={20} cy={20} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
        <circle
          cx={20}
          cy={20}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={4}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className={styles.ringLabel}>{pct}%</span>
    </span>
  );
}

/** Each answered group's lamps, worst first; a click scrolls to its panel. */
function HealthStrip({ values, schema }: { values: Values; schema: Schema }) {
  const groups = answeredGroups(schema, values).filter((group) => groupHealth(group, values).n > 0);
  if (groups.length === 0) return null;
  const order: Lamp[] = ['bad', 'watch', 'good', 'grey'];
  return (
    <div className={styles.health} data-health-strip>
      {groups.map((group) => {
        const h = groupHealth(group, values);
        return (
          <button
            key={group.id}
            type="button"
            className={styles.healthCell}
            title={group.title}
            onClick={(e) =>
              (e.currentTarget.getRootNode() as Document | ShadowRoot)
                .getElementById?.(`panel-${group.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          >
            <span className={styles.sub}>{group.title}</span>
            <span>
              {order.flatMap((k) => Array<Lamp>(h.counts[k]).fill(k)).map((k, i) => (
                <LampDot key={i} lamp={k} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Size: the composition bar and the facts beside it. */
function Kpis({ values, schema, t }: { values: Values; schema: Schema; t: Text }) {
  const parts = schema.composition.map((c) => ({ ...c, n: values[c.key]?.n ?? 0 }));
  const total = parts.reduce((a, p) => a + p.n, 0);
  const ratio = values.ratio?.b ?? values.ratio?.v ?? '—';
  const adr = values.adr?.n;
  const hasRatio = Boolean(values.ratio?.b ?? values.ratio?.v);
  // ADRs alone are already in the Specification group; the block is for size.
  if (total === 0 && !hasRatio) return null;
  return (
    <div className={styles.kpis} data-kpis>
      {total > 0 && (
        <div className={styles.compo}>
          <div className={styles.cbar}>
            {parts
              .filter((p) => p.n)
              .map((p) => (
                <span
                  key={p.key}
                  style={{ width: `${((p.n / total) * 100).toFixed(2)}%`, background: p.color }}
                  title={`${p.label}: ${p.n.toLocaleString('en-US')}`}
                />
              ))}
          </div>
          <div className={styles.chips}>
            {parts.map((p) => (
              <span key={p.key} className={styles.sub}>
                <i className={styles.swatch} style={{ background: p.color }} /> {p.label} <b>{p.n.toLocaleString('en-US')}</b>
              </span>
            ))}
            <span className={styles.sub}>{t('lines_total', { count: total.toLocaleString('en-US') })}</span>
          </div>
        </div>
      )}
      <div className={styles.facts}>
        {total > 0 && <Fact label={t('total_lines')} value={total.toLocaleString('en-US')} note={t('total_lines_note')} />}
        {hasRatio && <Fact label={t('spec_to_code')} value={ratio} note={t('spec_to_code_note')} />}
        {adr !== undefined && <Fact label={t('adrs')} value={String(adr)} note={t('adrs_note')} />}
      </div>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.fact}>
      <span className={styles.sub}>{label}</span>
      <b className={styles.factValue}>{value}</b>
      <span className={styles.sub}>{note}</span>
    </div>
  );
}

interface GradePart {
  area: string;
  label: string;
  pass: boolean;
  known?: boolean;
  fix: string;
}

/** The grade, criterion by criterion; failures first within each area. */
function QualityPanel({ values, t }: { values: Values; t: Text }) {
  const g = values.grade as (FieldVal & { parts?: GradePart[] }) | null | undefined;
  if (!g?.b || !g.parts?.length) return null;
  const areas: string[] = [];
  for (const p of g.parts) if (!areas.includes(p.area)) areas.push(p.area);
  return (
    <section className={styles.panel} id="panel-quality" data-quality>
      <header className={styles.panelHead}>
        <Badge variant={g.s === 'bad' ? 'danger' : g.s === 'watch' ? 'warning' : 'success'}>{g.b}</Badge>
        <h2 className={styles.panelTitle}>{t('quality')}</h2>
        <span className={styles.sub}>{g.v}</span>
      </header>
      <div className={styles.qareas}>
        {areas.map((area) => {
          const parts = g.parts!.filter((p) => p.area === area).sort((a, b) => Number(a.pass) - Number(b.pass));
          const met = parts.filter((p) => p.pass).length;
          return (
            <div key={area}>
              <div className={styles.row}>
                <b>{area}</b>
                <span className={styles.sub}>
                  {met} / {parts.length}
                </span>
              </div>
              <ul className={styles.plainList}>
                {parts.map((p) => (
                  <li key={p.label}>
                    {/* No answer is not a red finding: it is data nobody connected yet. */}
                    <LampDot lamp={p.pass ? 'good' : p.known === false ? 'watch' : 'bad'} /> {p.label}
                    {!p.pass && (
                      <span className={styles.sub}>
                        {' '}
                        {p.known === false ? `${t('no_data')} · ` : ''}
                        {p.fix}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Who answers for the component, role by role, and which roles nobody holds. */
function ResponsibilityPanel({ values, t }: { values: Values; t: Text }) {
  const map = responsibilityOf(values);
  return (
    <section className={styles.panel} id="panel-responsibility" data-responsibility>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t('responsibility')}</h2>
        <span className={styles.sub}>{t('roles_held', { held: map.held, total: map.roles.length })}</span>
      </header>
      <div className={styles.respGrid}>
        {map.roles.map((r) => (
          <div key={r.key} className={styles.respRole}>
            <span className={styles.sub}>{r.role}</span>
            {r.holders.length ? (
              <span>
                <LampDot lamp={r.lamp} /> {r.link ? <OutLink href={r.link}>{r.holders.join(', ')}</OutLink> : r.holders.join(', ')}
              </span>
            ) : (
              <span className={styles.muted}>{t('not_recorded')}</span>
            )}
            <span className={styles.sub}>{r.source}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const TONE_KEY = { better: 'tone_better', worse: 'tone_worse', neutral: 'tone_changed' } as const;

/** What moved since the window opened, against the snapshot the catalogue kept then. */
function ChangesPanel({
  trend,
  days,
  onDays,
  t,
}: {
  trend: FieldTrend | undefined;
  days: number;
  onDays: (days: number) => void;
  t: Text;
}) {
  return (
    <section className={styles.panel} id="panel-changes" data-changes>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>
          {trend ? t('since', { when: whenLabel(trend.since) || trend.since }) : t('since_days', { days })}
        </h2>
        <span className={styles.sub}>
          {trend
            ? t('changes_counts', { changed: trend.changes.length, worse: trend.worse, better: trend.better })
            : t('no_snapshot')}
        </span>
        <span className={styles.chips}>
          {WINDOWS.map((w) => (
            <Button key={w} size="sm" variant={w === days ? 'secondary' : 'ghost'} aria-pressed={w === days} onClick={() => onDays(w)}>
              {t('window_days', { days: w })}
            </Button>
          ))}
        </span>
      </header>
      {!trend ? (
        <p className={styles.sub}>{t('no_snapshot_body')}</p>
      ) : trend.changes.length === 0 ? (
        <p className={styles.sub}>{t('nothing_changed', { since: trend.since })}</p>
      ) : (
        <Table>
          <TableBody>
            {trend.changes.map((c) => (
              <TableRow key={c.key}>
                <TableCell>{c.label}</TableCell>
                <TableCell className={styles.muted}>{c.before}</TableCell>
                <TableCell>→</TableCell>
                <TableCell>{c.now}</TableCell>
                <TableCell>
                  <span className={c.tone === 'worse' ? styles.worse : c.tone === 'better' ? styles.better : styles.sub}>
                    {t(TONE_KEY[c.tone])}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Panel({ group, values, view, t }: { group: Group; values: Values; view: View; t: Text }) {
  const health = groupHealth(group, values);
  return (
    <section className={styles.panel} id={`panel-${group.id}`} data-panel={group.id}>
      <header className={styles.panelHead}>
        <span className={styles.panelIcon}>{group.icon}</span>
        <h2 className={styles.panelTitle}>{group.title}</h2>
        {view === 'filled' && health.worst && <LampDot lamp={health.worst} />}
        <span className={styles.sub}>{group.fields.length}</span>
      </header>
      <div className={styles.rows}>
        {group.fields.map((field) => {
          const raw = values[field.key] ?? null;
          const dated = view === 'filled' && raw?.u ? whenLabel(raw.u) : '';
          return (
            <div key={field.key} className={styles.fieldRow}>
              <span className={styles.sub}>{field.label}</span>
              <span>
                <ValueCell field={field} raw={raw} lamp={lampOf(field, values)} view={view} t={t} />
              </span>
              {dated && (
                <span className={styles.sub} title={t('last_changed', { when: raw?.u ?? '' })}>
                  {dated}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ValueCell({ field, raw, lamp, view, t }: { field: Field; raw: FieldVal | null; lamp: Lamp | null; view: View; t: Text }) {
  if (view === 'empty') return <span className={styles.muted}>?</span>;
  if (view === 'sources') {
    const chip = <Badge variant="secondary" title={field.source.class}>{field.source.ref}</Badge>;
    return raw?.l ? <OutLink href={raw.l}>{chip}</OutLink> : chip;
  }
  const brief = raw ? raw.b ?? raw.v ?? '' : null;
  if (!raw || brief === null) {
    return (
      <span className={styles.row}>
        {field.kind === 'label' ? <Badge variant="secondary">{t('not_set')}</Badge> : <span className={styles.muted}>{t('no_data')}</span>}
        <LampDot lamp={lamp} />
      </span>
    );
  }
  const text = field.kind === 'bool' ? ({ good: 'yes', watch: 'yes', bad: 'no', none: 'no' } as const)[raw.s ?? 'good'] : brief;
  const body = raw.l ? <OutLink href={raw.l}>{text}</OutLink> : <>{text}</>;
  return (
    <span className={styles.row}>
      {field.kind === 'label' || field.kind === 'docstate' ? (
        <Badge variant={field.kind === 'docstate' && brief === 'done' ? 'success' : field.kind === 'docstate' && brief === 'in progress' ? 'info' : 'secondary'}>
          {body}
        </Badge>
      ) : field.kind === 'status' ? (
        <b>{body}</b>
      ) : (
        <span className={field.kind === 'metric' ? styles.num : undefined}>{body}</span>
      )}
      <LampDot lamp={lamp} />
    </span>
  );
}

function Versions({ name, rows, repository, t }: { name: string; rows: CatalogNode[] | null; repository: string | undefined; t: Text }) {
  return (
    <section className={styles.panel} data-versions>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t('published_versions')}</h2>
        <span className={styles.sub}>{rows ? rows.length : '…'}</span>
        <span className={styles.chips}>
          {repository && <OutLink href={repository}>{t('repository')}</OutLink>}
          <OutLink href={`https://crates.io/crates/${encodeURIComponent(name)}`}>crates.io</OutLink>
        </span>
      </header>
      {rows === null ? (
        <p className={styles.sub}>{t('loading_versions')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.sub}>{t('no_versions')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_version')}</TableHead>
              <TableHead>{t('col_published')}</TableHead>
              <TableHead>{t('col_license')}</TableHead>
              <TableHead>Rust</TableHead>
              <TableHead>{t('col_size')}</TableHead>
              <TableHead className={styles.num}>{t('col_downloads')}</TableHead>
              <TableHead>{t('col_by')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.instance_id}>
                <TableCell>
                  <code>{String(v.value.num ?? '—')}</code>
                  {v.value.yanked ? <span className={styles.warnText}> · {t('yanked')}</span> : ''}
                </TableCell>
                <TableCell>{dateText(v.value.created_at)}</TableCell>
                <TableCell>{String(v.value.license ?? '—')}</TableCell>
                <TableCell>{String(v.value.rust_version ?? '—')}</TableCell>
                <TableCell>{sizeText(v.value.crate_size)}</TableCell>
                <TableCell className={styles.num}>{numText(v.value.downloads)}</TableCell>
                <TableCell>{publishedBy(v.value.published_by)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** The Studio-owned profile as JSON: it survives a crates.io sync. */
function ProfileEditor({
  name,
  profile,
  onSaved,
  t,
}: {
  name: string;
  profile: Record<string, unknown> | undefined;
  onSaved: (profile: Record<string, unknown>) => void;
  t: Text;
}) {
  const { org } = useScope();
  const [draft, setDraft] = useState(() => JSON.stringify(profile ?? defaultProfile(name), null, 2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api()
        .saveProfile(org?.id ?? null, name)
        .fetch({ profile: parseProfile(draft) });
      onSaved(saved.value as Record<string, unknown>);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.stack} data-profile-editor>
      <p className={styles.hint}>{t('profile_help')}</p>
      <Textarea
        className={styles.code}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        aria-label={t('edit_profile')}
      />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.row}>
        <Button disabled={saving} onClick={() => void save()} data-profile-save>
          {saving ? t('saving') : t('save_profile')}
        </Button>
      </div>
    </div>
  );
}
