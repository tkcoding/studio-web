import { describe, expect, it } from 'vitest';
import type { CatalogNode, FieldSchema, RegistryEntry, StudioKit } from '../api/types';
import {
  EMPTY_SCHEMA,
  GEAR_TYPE,
  KIT_TYPE,
  answeredGroups,
  categoriesOf,
  componentRows,
  componentTypesOf,
  displayName,
  filterCatalogue,
  groupHealth,
  indexSchemas,
  lampOf,
  licenceFromVersions,
  parseProfile,
  profilesByName,
  rowFacts,
  rowMatches,
  sameComponent,
  schemaFor,
  syncLine,
  whenLabel,
  withKits,
  type Field,
  type Schema,
} from './catalogue';

const node = (name: string, value: Partial<CatalogNode['value']> = {}, type_id = GEAR_TYPE): CatalogNode => ({
  type_id,
  instance_id: `id:${name}`,
  value: { name, ...value },
});

const field = (key: string, lamp = true): Field => ({
  key,
  label: key.toUpperCase(),
  kind: 'text',
  lamp,
  source: { class: 'repo', ref: 'gear.toml' },
});

const schema: Schema = {
  ...EMPTY_SCHEMA,
  groups: [
    { id: 'a', title: 'A', icon: 'A', fields: [field('owner'), field('coverage')] },
    { id: 'b', title: 'B', icon: 'B', fields: [field('notes', false)] },
  ],
};

const entry = (name: string, patch: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name,
  kind: 'gear',
  state: 'declared',
  capabilities: [],
  orphaned: false,
  occurrences: [{ repo: 'acme/app', path: `gears/${name}`, declared_in: 'gear.toml', project_id: 'p1' }],
  ...patch,
});

describe('the field schemas', () => {
  const served = [
    { describes: GEAR_TYPE, component: true, groups: [] },
    { describes: 'gts.x~', component: false, groups: [] },
  ] as unknown as FieldSchema[];

  it('are keyed by the type they describe, and a type without one falls back to the gear schema', () => {
    const schemas = indexSchemas(served);
    expect(Object.keys(schemas)).toEqual([GEAR_TYPE, 'gts.x~']);
    expect(schemaFor(schemas, 'gts.unknown~')).toBe(schemas[GEAR_TYPE]);
    expect(schemaFor({}, 'gts.unknown~')).toBe(EMPTY_SCHEMA);
  });

  it('say which types are components', () => {
    expect([...componentTypesOf(served)]).toEqual([GEAR_TYPE]);
  });
});

describe('lamps', () => {
  it('are grey for no answer, the answer’s own grade otherwise, and none for an ungraded field', () => {
    expect(lampOf(field('owner'), {})).toBe('grey');
    expect(lampOf(field('owner'), { owner: { b: 'x', s: 'bad' } })).toBe('bad');
    expect(lampOf(field('owner'), { owner: { b: 'x' } })).toBe('good');
    expect(lampOf(field('notes', false), { notes: { b: 'x' } })).toBeNull();
  });

  it('a group’s health is its worst lamp', () => {
    const h = groupHealth(schema.groups[0], { owner: { b: 'x', s: 'watch' }, coverage: { b: 'y', s: 'good' } });
    expect(h).toMatchObject({ worst: 'watch', n: 2 });
  });

  it('answered groups keep only answered fields', () => {
    expect(answeredGroups(schema, { owner: { b: 'x' } }).map((g) => g.fields.map((f) => f.key))).toEqual([['owner']]);
  });
});

describe('kits on the catalogue', () => {
  const kit: StudioKit = {
    slug: 'sdlc',
    name: 'SDLC',
    description: 'Delivery lifecycle',
    publisher: 'cf',
    visibility: 'public',
    source: 'builtin',
    repository_url: 'https://github.com/x/sdlc',
    default_version: '1.0.0',
    manifest_path: '',
  };

  it('a synced kit takes the registry’s description; a built-in no sync found is added', () => {
    const synced = node('sdlc', { description: '' }, KIT_TYPE);
    const out = withKits([synced], [kit, { ...kit, slug: 'pm', description: 'PM' }]);
    expect(out).toHaveLength(2);
    expect(out[0].value.description).toBe('Delivery lifecycle');
    expect(out[0].value.repository).toBe('https://github.com/x/sdlc');
    expect(out[1]).toMatchObject({ type_id: KIT_TYPE, instance_id: 'kit:pm', value: { tier: 'platform', kind: 'kit' } });
  });
});

describe('the catalogue list', () => {
  const nodes = [
    node('beta', { downloads: 5, component_kind: 'sdk', component_category: 'web' }),
    node('alpha', { downloads: 50, description: 'billing', component_kind: 'gear', component_category: 'bss' }),
    node('gamma', { component_excluded: 'a test helper', component_kind: 'gear' }),
  ];
  const base = { q: '', category: '', hideSdk: false, sort: 'name-asc' as const, componentTypes: null, resolvedCategory: () => undefined };

  it('searches names and descriptions, hides SDKs, filters by category and sorts', () => {
    expect(filterCatalogue(nodes, base).map((n) => n.value.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(filterCatalogue(nodes, { ...base, q: 'BILL' }).map((n) => n.value.name)).toEqual(['alpha']);
    expect(filterCatalogue(nodes, { ...base, hideSdk: true }).map((n) => n.value.name)).toEqual(['alpha', 'gamma']);
    expect(filterCatalogue(nodes, { ...base, category: 'we' }).map((n) => n.value.name)).toEqual(['beta']);
    expect(filterCatalogue(nodes, { ...base, sort: 'downloads-desc' }).map((n) => n.value.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(filterCatalogue(nodes, { ...base, componentTypes: new Set(['other']) })).toEqual([]);
  });

  it('offers the categories of what is a component', () => {
    expect(categoriesOf(nodes, () => undefined)).toEqual(['bss', 'web']);
  });

  it('a row’s facts: completeness, findings, the declared version and where it was read', () => {
    const facts = rowFacts(
      node('pkg', { synced_from: 'acme/front', repo_path: 'packages/pkg' }),
      { owner: { b: 'x', s: 'bad' }, version: { b: '0.3.0' } },
      schema,
      undefined,
      [{ kind: 'repository', label: 'acme/front' }]
    );
    expect(facts).toMatchObject({ pct: 33, bad: 1, watch: 0, version: '0.3.0', declared: '0.3.0' });
    expect(facts.repository).toBe('https://github.com/acme/front/tree/HEAD/packages/pkg');
  });
});

describe('the registry beside the catalogue', () => {
  it('matches an entry to its published crate by name, alias or the cf-gears- prefix', () => {
    expect(sameComponent(entry('billing'), 'cf-gears-billing')).toBe(true);
    expect(sameComponent(entry('billing', { aliases: ['bill'] }), 'bill')).toBe(true);
    expect(sameComponent(entry('billing'), 'payments')).toBe(false);
  });

  it('is one list: entries with their node, then the nodes no entry is', () => {
    const rows = componentRows([entry('billing')], [node('cf-gears-billing'), node('audit', { kind: 'gear' })]);
    expect(rows.map((r) => [r.name, r.state, !!r.entry, !!r.node])).toEqual([
      ['audit', 'published', false, true],
      ['billing', 'declared', true, true],
    ]);
  });

  it('a row is found by its name, description or a path it is declared at', () => {
    const [row] = componentRows([entry('billing')], []);
    expect(rowMatches(row, 'gears/bill')).toBe(true);
    expect(rowMatches(row, 'nothing')).toBe(false);
  });
});

describe('small helpers', () => {
  it('format names, dates and profiles', () => {
    expect(displayName('cf-gears-account-api')).toBe('Account API');
    expect(whenLabel('2026-10-05')).toBe('05 Oct');
    expect(licenceFromVersions([node('v1', { yanked: true, license: 'GPL' }), node('v2', { license: 'MIT' })])).toBe('MIT');
    expect(profilesByName([node('x', { gear_name: 'billing' })])).toEqual({ billing: { name: 'x', gear_name: 'billing' } });
    expect(() => parseProfile('[]')).toThrow('Profile must be a JSON object');
  });

  it('a sync run in one line', () => {
    expect(syncLine({ state: 'succeeded', result: { gears: 3, versions: 9 } })).toEqual({ done: true, ok: true, text: '3 gears · 9 versions' });
    expect(syncLine({ state: 'failed', last_error: 'boom' })).toEqual({ done: true, ok: false, text: 'boom' });
    expect(syncLine({ state: 'running', progress: 'reading…', result: { gears: 1 } })).toMatchObject({
      done: false,
      text: 'reading — 1 gears · 0 versions · 0 in graph…',
    });
  });
});
