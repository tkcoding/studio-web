/**
 * The report's plan, edited in Studio (the prototype's plan-editor.tsx).
 *
 * The planning team's `gears.yaml` — teams, people, consumer projects, and
 * per gear when each project needs it — in tabs, one section saved at a time
 * against the revision it was read at. The first save makes Studio the plan's
 * home: a file it was read from is let go. "Export gears.yaml" hands the text
 * back for the planning script or a backup.
 */

import { useEffect, useMemo, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@gears-frontx/ui-kit';
import { responseStatus } from '@constructor-studio/mfe-shared';
import { ReportsApiService } from '../../api/ReportsApiService';
import { downloadPlan } from '../../api/download';
import {
  NEED_SUGGESTIONS,
  linkOf,
  mirrorText,
  move,
  needOf,
  optional,
  parseNumber,
  quarters,
  teamChoices,
  withNeed,
  type LinkState,
  type Plan,
  type PlanPeople,
  type PlanSection,
} from '../../model/plan-model';
import { errText, minute, type Text } from './parts';
import styles from './ReportsScreen.module.css';

const TABS: PlanSection[] = ['units', 'people', 'projects', 'needs', 'lanes'];

function sectionOf(p: Plan, s: PlanSection): unknown {
  return s === 'units' ? [p.units, p.no_unit_color] : p[s];
}

function same(a: Plan, b: Plan, s: PlanSection): boolean {
  return JSON.stringify(sectionOf(a, s)) === JSON.stringify(sectionOf(b, s));
}

/** A number input that keeps what is typed until it reads as a number. */
function NumberField({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
}) {
  const shown = value == null ? '' : String(value);
  // What was typed, for the value it was typed against: a value changed from
  // outside (a reload, an undo) shows itself again.
  const [typed, setTyped] = useState<{ value: number | null; text: string } | null>(null);
  const text = typed && typed.value === value ? typed.text : shown;
  const parsed = parseNumber(text);
  return (
    <Input
      className={styles.numInput}
      aria-label={label}
      aria-invalid={parsed === undefined}
      value={text}
      inputMode="decimal"
      onChange={(e) => {
        const next = e.target.value;
        const v = parseNumber(next);
        setTyped({ value: v === undefined ? value : v, text: next });
        if (v !== undefined) onChange(v);
      }}
    />
  );
}

function RowButtons({
  onUp,
  onDown,
  onRemove,
  t,
}: {
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  t: Text;
}) {
  return (
    <span className={styles.rowButtons}>
      {onUp && (
        <Button variant="ghost" size="sm" title={t('move_up')} aria-label={t('move_up')} onClick={onUp}>
          ↑
        </Button>
      )}
      {onDown && (
        <Button variant="ghost" size="sm" title={t('move_down')} aria-label={t('move_down')} onClick={onDown}>
          ↓
        </Button>
      )}
      <Button variant="ghost" size="sm" title={t('remove')} aria-label={t('remove')} onClick={onRemove}>
        ×
      </Button>
    </span>
  );
}

/** Who a login is in Studio, in a word or two. */
function LinkCell({
  state,
  nameOf,
  available,
  t,
}: {
  state: LinkState;
  nameOf: (id: string) => string;
  available: boolean;
  t: Text;
}) {
  if (!available) return <span className={styles.muted}>—</span>;
  switch (state.kind) {
    case 'member':
      return <span title={t('link_member_hint')}>✓ {nameOf(state.personId)}</span>;
    case 'outsider':
      return (
        <span className={styles.muted} title={t('link_outsider_hint')}>
          {t('link_outsider', { name: nameOf(state.personId) })}
        </span>
      );
    case 'unknown':
      return (
        <span className={styles.muted} title={t('link_unknown_hint')}>
          {t('link_unknown')}
        </span>
      );
    case 'unsaved':
      return (
        <span className={styles.muted} title={t('link_unsaved_hint')}>
          …
        </span>
      );
  }
}

export function PlanEditor({
  organizationId,
  report,
  studioProjects,
  onSaved,
  t,
}: {
  /** The organization on screen: its members name the linked people. */
  organizationId: string;
  report: string;
  /** The organization's Studio workspaces, which a consumer project can be. */
  studioProjects: { id: string; name: string }[];
  onSaved: () => void;
  t: Text;
}) {
  const api = apiRegistry.getService(ReportsApiService);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [tab, setTab] = useState<PlanSection>('units');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState('');
  const [links, setLinks] = useState<PlanPeople | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  /** Bumped by Reload: the plan is read again. */
  const [reads, setReads] = useState(0);
  const params = useMemo(() => ({ organizationId, reportId: report }), [organizationId, report]);

  const loadLinks = () => {
    api
      .planPeople(params)
      .fetch({ staleTime: 0 })
      .then(setLinks)
      .catch(() => setLinks(null));
  };

  useEffect(() => {
    let live = true;
    api
      .plan(params)
      .fetch({ staleTime: 0 })
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setDraft(p);
      })
      .catch((e: unknown) => live && setNote(errText(e)));
    api
      .planPeople(params)
      .fetch({ staleTime: 0 })
      .then((l) => live && setLinks(l))
      .catch(() => live && setLinks(null));
    return () => {
      live = false;
    };
  }, [api, params, reads]);

  // Names come from the members list, which needs `people.view`; without it
  // a linked person is shown by id.
  useEffect(() => {
    let live = true;
    api
      .members(organizationId)
      .then((ms) => live && setNames(new Map(ms.map((m) => [m.user_id, m.display_name || m.email || m.user_id]))))
      .catch(() => live && setNames(new Map()));
    return () => {
      live = false;
    };
  }, [api, organizationId]);
  const nameOf = (id: string) => names.get(id) ?? `${id.slice(0, 8)}…`;

  // The quarters are read once, when the editor opens.
  const [suggestions] = useState(() => [...NEED_SUGGESTIONS, ...quarters(new Date())]);

  if (!plan || !draft) return <p className={styles.muted}>{note ?? t('reading_plan')}</p>;

  const dirty = (s: PlanSection) => !same(plan, draft, s);
  const set = (p: Partial<Plan>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const tabLabel = (s: PlanSection) => t(`plan_tab_${s}`);

  const save = async (s: PlanSection) => {
    if (plan.file && !window.confirm(t('plan_confirm_home', { file: plan.file }))) return;
    setBusy(true);
    setNote(null);
    try {
      const saved = await api.updatePlan(params, s, { ...draft, revision: plan.revision });
      setPlan(saved);
      // The other sections keep whatever is still being edited in them.
      setDraft((d) => {
        if (!d) return saved;
        const next: Plan = { ...saved };
        for (const other of TABS) {
          if (other !== s && !same(plan, d, other)) {
            if (other === 'units') {
              next.units = d.units;
              next.no_unit_color = d.no_unit_color;
            } else {
              (next as unknown as Record<string, unknown>)[other] = d[other];
            }
          }
        }
        return next;
      });
      setNote(t('saved'));
      if (s === 'people') loadLinks();
      onSaved();
    } catch (e) {
      if (responseStatus(e) === 409) {
        setStale(true);
        setNote(t('plan_stale'));
      } else {
        setNote(errText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const exportYaml = async () => {
    try {
      await downloadPlan(organizationId, report);
    } catch (e) {
      setNote(errText(e));
    }
  };

  const publishTeams = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote(mirrorText(await api.syncPlan(params).fetch(undefined)));
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const reload = () => {
    setStale(false);
    setNote(null);
    setReads((n) => n + 1);
  };

  const undo = () =>
    setDraft((d) =>
      d
        ? tab === 'units'
          ? { ...d, units: plan.units, no_unit_color: plan.no_unit_color }
          : ({ ...d, [tab]: plan[tab] } as Plan)
        : d
    );

  const teams = teamChoices(draft.units);
  const projects = draft.projects;
  const from = plan.from ? (plan.from === 'studio' ? t('plan_from_studio') : t('plan_from', { from: plan.from })) : '';
  const listId = `need-suggestions-${report}`;

  return (
    <div className={styles.stack} data-plan-editor>
      <div className={styles.row}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as PlanSection)}>
          <TabsList variant="line" aria-label={t('plan_tabs')}>
            {TABS.map((s) => (
              <TabsTrigger key={s} value={s} data-plan-tab={s}>
                {tabLabel(s)}
                {dirty(s) ? ' •' : ''}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className={styles.grow} />
        <Button
          variant="outline"
          size="sm"
          disabled={plan.revision === 0 || busy}
          title={t('publish_teams_hint')}
          onClick={() => void publishTeams()}
          data-plan-publish
        >
          {t('publish_teams')}
        </Button>
        <Button variant="outline" size="sm" disabled={plan.revision === 0} onClick={() => void exportYaml()} data-plan-export>
          {t('export_yaml')}
        </Button>
      </div>
      <p className={styles.hint}>
        {plan.revision === 0
          ? t('plan_none')
          : t('plan_revision', {
              revision: plan.revision,
              from: from ? `, ${from}` : '',
              at: plan.changed_at ? `, ${minute(plan.changed_at)}` : '',
            })}
        {plan.file && ` ${t('plan_read_from', { file: plan.file })}`}
      </p>

      {tab === 'units' && (
        <div className={styles.stack}>
          {draft.units.map((u, ui) => {
            const setUnit = (patch: Partial<typeof u>) =>
              set({ units: draft.units.map((x, i) => (i === ui ? { ...x, ...patch } : x)) });
            return (
              <div key={ui} className={styles.unit} data-plan-unit={ui}>
                <div className={styles.row}>
                  <Input
                    className={styles.unitName}
                    placeholder={t('unit')}
                    aria-label={t('unit')}
                    value={u.name}
                    onChange={(e) => setUnit({ name: e.target.value })}
                  />
                  <Input
                    className={styles.colour}
                    placeholder={t('colour')}
                    aria-label={t('colour')}
                    value={u.color ?? ''}
                    onChange={(e) => setUnit({ color: optional(e.target.value) })}
                  />
                  <span className={styles.grow} />
                  <RowButtons
                    t={t}
                    onUp={ui > 0 ? () => set({ units: move(draft.units, ui, ui - 1) }) : undefined}
                    onDown={ui < draft.units.length - 1 ? () => set({ units: move(draft.units, ui, ui + 1) }) : undefined}
                    onRemove={() => set({ units: draft.units.filter((_, i) => i !== ui) })}
                  />
                </div>
                <Table className={styles.small}>
                  <TableHeader>
                    <TableRow>
                      {(['col_tag', 'col_team', 'colour', 'col_people', 'col_power'] as const).map((h) => (
                        <TableHead key={h}>{t(h)}</TableHead>
                      ))}
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {u.teams.map((tm, ti) => {
                      const setTeam = (patch: Partial<typeof tm>) =>
                        setUnit({ teams: u.teams.map((x, i) => (i === ti ? { ...x, ...patch } : x)) });
                      return (
                        <TableRow key={ti}>
                          <TableCell>
                            <Input aria-label={t('col_tag')} value={tm.tag} onChange={(e) => setTeam({ tag: e.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input aria-label={t('col_team')} value={tm.name} onChange={(e) => setTeam({ name: e.target.value })} />
                          </TableCell>
                          <TableCell>
                            <Input
                              className={styles.colour}
                              aria-label={t('colour')}
                              value={tm.color ?? ''}
                              onChange={(e) => setTeam({ color: optional(e.target.value) })}
                            />
                          </TableCell>
                          <TableCell>
                            <NumberField label={t('col_people')} value={tm.people} onChange={(v) => setTeam({ people: v })} />
                          </TableCell>
                          <TableCell>
                            <NumberField label={t('col_power')} value={tm.power} onChange={(v) => setTeam({ power: v })} />
                          </TableCell>
                          <TableCell>
                            <RowButtons t={t} onRemove={() => setUnit({ teams: u.teams.filter((_, i) => i !== ti) })} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Button
                  variant="outline"
                  size="sm"
                  className={styles.start}
                  onClick={() => setUnit({ teams: [...u.teams, { tag: '', name: '', color: u.color, people: null, power: null }] })}
                >
                  {t('add_team')}
                </Button>
              </div>
            );
          })}
          <div className={styles.row}>
            <Button variant="outline" size="sm" onClick={() => set({ units: [...draft.units, { name: '', color: null, teams: [] }] })}>
              {t('add_unit')}
            </Button>
            <span className={styles.hint}>{t('no_unit_colour')}</span>
            <Input
              className={styles.colour}
              aria-label={t('no_unit_colour')}
              value={draft.no_unit_color ?? ''}
              onChange={(e) => set({ no_unit_color: optional(e.target.value) })}
            />
          </div>
        </div>
      )}

      {tab === 'people' && (
        <div className={styles.stack}>
          <Input placeholder={t('people_filter')} aria-label={t('people_filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Table className={styles.small} data-plan-people>
            <TableHeader>
              <TableRow>
                {(['col_login', 'col_in_studio', 'col_alias', 'col_team', 'col_power', 'col_email'] as const).map((h) => (
                  <TableHead key={h}>{t(h)}</TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.people.map((p, pi) => {
                const f = filter.trim().toLowerCase();
                if (f && ![p.login, p.alias ?? '', p.team ?? ''].some((v) => v.toLowerCase().includes(f))) return null;
                const setPerson = (patch: Partial<typeof p>) =>
                  set({ people: draft.people.map((x, i) => (i === pi ? { ...x, ...patch } : x)) });
                return (
                  <TableRow key={pi}>
                    <TableCell>
                      <Input aria-label={t('col_login')} value={p.login} onChange={(e) => setPerson({ login: e.target.value })} />
                    </TableCell>
                    <TableCell className={styles.nowrap}>
                      <LinkCell
                        t={t}
                        state={linkOf(links, p.login)}
                        nameOf={nameOf}
                        available={links?.identities_available ?? false}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('col_alias')}
                        value={p.alias ?? ''}
                        onChange={(e) => setPerson({ alias: optional(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        size="sm"
                        aria-label={t('col_team')}
                        value={p.team ?? ''}
                        onChange={(e) => setPerson({ team: optional(e.target.value) })}
                      >
                        <NativeSelectOption value="">—</NativeSelectOption>
                        {p.team && !teams.some((tm) => tm.tag === p.team) && (
                          <NativeSelectOption value={p.team}>{p.team}</NativeSelectOption>
                        )}
                        {teams.map((tm) => (
                          <NativeSelectOption key={tm.tag} value={tm.tag}>
                            {tm.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell>
                      <NumberField label={t('col_power')} value={p.power} onChange={(v) => setPerson({ power: v })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('col_email')}
                        value={p.email ?? ''}
                        onChange={(e) => setPerson({ email: optional(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <RowButtons t={t} onRemove={() => set({ people: draft.people.filter((_, i) => i !== pi) })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Button
            variant="outline"
            size="sm"
            className={styles.start}
            onClick={() => set({ people: [...draft.people, { login: '', alias: null, team: null, unit: null, power: 1, email: null }] })}
          >
            {t('add_person')}
          </Button>
          {links && links.identities_available && (links.unplanned.length > 0 || links.members_without_github > 0) && (
            <div className={styles.unplanned} data-plan-unplanned>
              {links.unplanned.length > 0 && (
                <>
                  <p className={styles.hint}>{t('unplanned_members')}</p>
                  <div className={styles.stack}>
                    {links.unplanned
                      .filter((u) => !draft.people.some((p) => u.github.some((g) => g.toLowerCase() === p.login.trim().toLowerCase())))
                      .map((u) => (
                        <span key={u.person_id} className={styles.row}>
                          <span>{nameOf(u.person_id)}</span>
                          <code>{u.github.join(', ')}</code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              set({
                                people: [
                                  ...draft.people,
                                  {
                                    login: u.github[0],
                                    alias: names.get(u.person_id) ?? null,
                                    team: null,
                                    unit: null,
                                    power: 1,
                                    email: null,
                                  },
                                ],
                              })
                            }
                          >
                            {t('add_to_plan')}
                          </Button>
                        </span>
                      ))}
                  </div>
                </>
              )}
              {links.members_without_github > 0 && (
                <p className={styles.hint}>{t.count('members_without_github', links.members_without_github)}</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'projects' && (
        <div className={styles.stack}>
          <Table className={styles.small} data-plan-projects>
            <TableHeader>
              <TableRow>
                {(['col_key', 'col_name', 'col_source_column', 'col_studio_project'] as const).map((h) => (
                  <TableHead key={h}>{t(h)}</TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p, pi) => {
                const setProject = (patch: Partial<typeof p>) =>
                  set({ projects: projects.map((x, i) => (i === pi ? { ...x, ...patch } : x)) });
                return (
                  <TableRow key={pi}>
                    <TableCell>
                      <Input aria-label={t('col_key')} value={p.key} onChange={(e) => setProject({ key: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input aria-label={t('col_name')} value={p.name} onChange={(e) => setProject({ name: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('col_source_column')}
                        value={p.source_header ?? ''}
                        onChange={(e) => setProject({ source_header: optional(e.target.value) })}
                      />
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        size="sm"
                        aria-label={t('col_studio_project')}
                        value={p.studio_project ?? ''}
                        onChange={(e) => setProject({ studio_project: optional(e.target.value) })}
                      >
                        <NativeSelectOption value="">{t('outside_studio')}</NativeSelectOption>
                        {p.studio_project && !studioProjects.some((s) => s.id === p.studio_project) && (
                          <NativeSelectOption value={p.studio_project}>
                            {t('not_in_org', { id: p.studio_project.slice(0, 8) })}
                          </NativeSelectOption>
                        )}
                        {studioProjects.map((s) => (
                          <NativeSelectOption key={s.id} value={s.id}>
                            {s.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell>
                      <RowButtons
                        t={t}
                        onUp={pi > 0 ? () => set({ projects: move(projects, pi, pi - 1) }) : undefined}
                        onDown={pi < projects.length - 1 ? () => set({ projects: move(projects, pi, pi + 1) }) : undefined}
                        onRemove={() => set({ projects: projects.filter((_, i) => i !== pi) })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className={styles.hint}>{t('projects_order_hint')}</p>
          <Button
            variant="outline"
            size="sm"
            className={styles.start}
            onClick={() => set({ projects: [...projects, { key: '', name: '', source_header: null, studio_project: null }] })}
          >
            {t('add_project')}
          </Button>
        </div>
      )}

      {tab === 'needs' && (
        <div className={`${styles.stack} ${styles.scroll}`}>
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <Table className={styles.small} data-plan-needs>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t('col_gear')}</TableHead>
                {projects.map((p) => (
                  <TableHead key={p.key} title={p.key}>
                    {p.name}
                  </TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.needs.map((n, ni) => {
                const setNeed = (next: typeof n) => set({ needs: draft.needs.map((x, i) => (i === ni ? next : x)) });
                return (
                  <TableRow key={ni}>
                    <TableCell>
                      <Input
                        className={styles.numInput}
                        aria-label="#"
                        value={n.number}
                        onChange={(e) => setNeed({ ...n, number: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className={styles.gearInput}
                        aria-label={t('col_gear')}
                        value={n.title ?? ''}
                        onChange={(e) => setNeed({ ...n, title: optional(e.target.value) })}
                      />
                    </TableCell>
                    {projects.map((p) => (
                      <TableCell key={p.key}>
                        <Input
                          className={styles.needInput}
                          aria-label={p.name}
                          list={listId}
                          value={needOf(n, p.key)}
                          onChange={(e) => setNeed(withNeed(n, p.key, e.target.value, projects))}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <RowButtons t={t} onRemove={() => set({ needs: draft.needs.filter((_, i) => i !== ni) })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className={styles.hint}>{t('needs_hint')}</p>
          <Button
            variant="outline"
            size="sm"
            className={styles.start}
            onClick={() => set({ needs: [...draft.needs, { number: '', title: null, gear: null, group: null, needs: [] }] })}
          >
            {t('add_gear')}
          </Button>
        </div>
      )}

      {tab === 'lanes' && (
        <div className={styles.stack}>
          <Table className={styles.small} data-plan-lanes>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_group')}</TableHead>
                <TableHead>{t('col_shown_as')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.lanes.order.map((g, gi) => {
                const label = draft.lanes.labels.find((l) => l.group.toUpperCase() === g.toUpperCase())?.label ?? '';
                const setLanes = (order: string[], labels = draft.lanes.labels) => set({ lanes: { order, labels } });
                return (
                  <TableRow key={gi}>
                    <TableCell>
                      <Input
                        aria-label={t('col_group')}
                        value={g}
                        onChange={(e) => setLanes(draft.lanes.order.map((x, i) => (i === gi ? e.target.value : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('col_shown_as')}
                        value={label}
                        onChange={(e) => {
                          const rest = draft.lanes.labels.filter((l) => l.group.toUpperCase() !== g.toUpperCase());
                          const labels = e.target.value.trim() ? [...rest, { group: g, label: e.target.value }] : rest;
                          setLanes(draft.lanes.order, labels);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <RowButtons
                        t={t}
                        onUp={gi > 0 ? () => setLanes(move(draft.lanes.order, gi, gi - 1)) : undefined}
                        onDown={gi < draft.lanes.order.length - 1 ? () => setLanes(move(draft.lanes.order, gi, gi + 1)) : undefined}
                        onRemove={() => setLanes(draft.lanes.order.filter((_, i) => i !== gi))}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className={styles.hint}>{t('lanes_hint')}</p>
          <Button
            variant="outline"
            size="sm"
            className={styles.start}
            onClick={() => set({ lanes: { ...draft.lanes, order: [...draft.lanes.order, ''] } })}
          >
            {t('add_lane')}
          </Button>
        </div>
      )}

      <div className={styles.row}>
        <Button size="sm" loading={busy} disabled={busy || stale || !dirty(tab)} onClick={() => void save(tab)} data-plan-save>
          {busy ? t('saving') : t('save_section', { section: tabLabel(tab).toLowerCase() })}
        </Button>
        <Button variant="outline" size="sm" disabled={busy || !dirty(tab)} onClick={undo}>
          {t('undo_changes')}
        </Button>
        {stale && (
          <Button variant="outline" size="sm" onClick={reload} data-plan-reload>
            {t('reload')}
          </Button>
        )}
        {note && (
          <span className={stale ? styles.error : styles.hint} data-plan-note>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
