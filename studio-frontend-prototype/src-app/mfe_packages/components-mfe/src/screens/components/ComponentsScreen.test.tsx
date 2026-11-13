import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';
import type { CatalogNode, PublicationRequest, RegistryEntry } from '../../api/types';
import en from './i18n/en.json';
import ru from './i18n/ru.json';

const { service, org, calls, opened } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  org: { value: { id: 'o1', name: 'Acme' } as { id: string; name: string } | null },
  calls: [] as { name: string; params?: unknown; body?: unknown }[],
  opened: [] as string[],
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key}_${count === 1 ? 'one' : 'many'} ${count}`;
  return { useComponentsTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: org.value, loading: false, failed: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  openScreen: (_bridge: unknown, route: string) => opened.push(route),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  // No shell in these tests: the section falls back to the extension id.
  useSharedProperty: () => null,
}));

import { ComponentsScreen, scopeOf, viewOf } from './ComponentsScreen';

const ROOT = '00000000-0000-0000-0000-000000000001';

/** A read: `name(params).fetch()`. */
const read = (name: string, value: unknown) => (params?: unknown) => ({
  fetch: () => {
    calls.push({ name, params });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});
/** A write: `name(...args).fetch(body)`. */
const write = (name: string, value: unknown) => (...args: unknown[]) => ({
  fetch: (body: unknown) => {
    calls.push({ name, params: args, body });
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  },
});
const refused = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

const gear = (name: string, tier: 'platform' | 'organization', value: Partial<CatalogNode['value']> = {}): CatalogNode => ({
  type_id: 'gts.cf.studio.catalog.gear.v1~',
  instance_id: `g:${name}`,
  value: { name, tier, description: `${name} does things`, max_version: '1.2.0', downloads: 42, ...value },
});

const entry = (name: string, patch: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name,
  kind: 'gear',
  state: 'declared',
  capabilities: [],
  orphaned: false,
  occurrences: [{ repo: 'acme/app', path: `gears/${name}`, declared_in: 'gear.toml', project_id: 'p1', project_name: 'App' }],
  ...patch,
});

function serve(over: Record<string, unknown> = {}, home = 'o1') {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    getMe: { fetch: () => Promise.resolve({ subject_id: 'me', subject_tenant_id: home }) },
    // The gear type is a component type here: the list shows its nodes.
    fieldSchemas: read('fieldSchemas', {
      schemas: [{ describes: 'gts.cf.studio.catalog.gear.v1~', component: true, groups: [], composition: [] }],
    }),
    components: read('components', { nodes: [gear('billing', 'organization'), gear('audit', 'platform')] }),
    profiles: read('profiles', { nodes: [] }),
    componentValues: read('componentValues', { items: [], total: 0, truncated: false }),
    componentHistory: read('componentHistory', { items: [], total: 0 }),
    versions: read('versions', { nodes: [{ type_id: 'v', instance_id: 'v1', value: { num: '1.2.0', license: 'MIT', downloads: 7 } }] }),
    registry: read('registry', {
      items: [entry('billing'), entry('scoring', { state: 'candidate', score: 5, evidence: [{ signal: 'rest', detail: 'own REST surface', weight: 3 }] })],
      total: 2,
    }),
    registryExcludedProjects: read('registryExcludedProjects', { project_ids: [] }),
    registryProjects: read('registryProjects', {
      items: [{ project_id: 'p1', project_name: 'App', at: '', repos: [{ repo: 'acme/app', status: 'read', components: 2 }] }],
      total: 1,
    }),
    registryEntry: read('registryEntry', { ...entry('billing'), decisions: [] }),
    decide: write('decide', { ...entry('billing', { state: 'registered' }), decisions: [] }),
    saveExcludedProjects: write('saveExcludedProjects', { project_ids: ['p1'] }),
    publicationRequests: read('publicationRequests', { items: [] }),
    answerPublication: write('answerPublication', {}),
    curators: read('curators', { items: [], may_manage: false }),
    platformSources: read('platformSources', { items: [], total: 0, crates_io: 'constructorfabric' }),
    savePlatformSources: write('savePlatformSources', { items: [], total: 0, crates_io: null }),
    connections: read('connections', { items: [] }),
    myProfile: { fetch: () => Promise.resolve({ id: 'me', display_name: 'Ada' }) },
    kits: () => Promise.resolve([]),
    colleagues: () => Promise.resolve([{ user_id: 'u2', display_name: 'Grace' }]),
    members: () => Promise.resolve([]),
    ...over,
  });
}

const bridgeFor = (suffix: string) => ({ extensionId: `gts…~constructor_studio.components.screens.${suffix}.v1` }) as ChildMfeBridge;

describe('ComponentsScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    opened.length = 0;
    org.value = { id: 'o1', name: 'Acme' };
    serve();
  });

  it('knows which of its four screens the shell mounted', () => {
    expect(scopeOf('gts…~constructor_studio.components.screens.platform.v1')).toBe('platform');
    expect(scopeOf('gts…~constructor_studio.components.screens.organization.v1')).toBe('organization');
    expect(scopeOf('gts…~constructor_studio.components.screens.repositories.v1')).toBe('repositories');
    expect(scopeOf('gts…~constructor_studio.components.screens.publications.v1')).toBe('publications');
    expect(scopeOf(undefined)).toBe('platform');
    // The three platform extensions share one entry: the shell's section token wins.
    expect(viewOf(undefined, 'repositories')).toBe('repositories');
    expect(viewOf(undefined, 'publications')).toBe('publications');
    expect(viewOf('gts…~constructor_studio.components.screens.organization.v1', 'catalogue')).toBe('platform');
    expect(viewOf('gts…~constructor_studio.components.screens.organization.v1', null)).toBe('organization');
  });

  it('asks for an organization on the organization’s screen when none is in scope', () => {
    org.value = null;
    render(<ComponentsScreen bridge={bridgeFor('organization')} />);
    expect(screen.getByText('no_org')).toBeTruthy();
  });

  it('Organization › Components lists the registry beside the catalogue, named for the organization', async () => {
    render(<ComponentsScreen bridge={bridgeFor('organization')} />);
    const row = await screen.findByText('billing', { selector: '[data-registry-row] span' });
    expect(row).toBeTruthy();
    // The organization's own catalogue node, and not the platform's.
    expect(screen.queryByText('audit')).toBeNull();
    expect(calls.find((c) => c.name === 'registry')?.params).toEqual({ org: 'o1' });
    // The candidate is counted in the header and behind its chip.
    expect(screen.getByText('needs_decision_one 1')).toBeTruthy();
    fireEvent.click(screen.getByText('needs_decision_chip {"count":1}'));
    expect(await screen.findByText('own REST surface (+3)')).toBeTruthy();
  });

  it('a row opens under itself, and Register records the decision with its owner', async () => {
    render(<ComponentsScreen bridge={bridgeFor('organization')} />);
    fireEvent.click(await screen.findByText('billing', { selector: '[data-registry-row] span' }));
    const detail = await screen.findByText('decide');
    const decisions = detail.closest('[data-registry-decisions]') as HTMLElement;
    fireEvent.click(within(decisions).getByText('Register'));
    // A person picked from the colleagues names the owner.
    await waitFor(() => expect(within(decisions).getAllByRole('combobox').length).toBeGreaterThan(1));
    fireEvent.change(within(decisions).getAllByRole('combobox')[1], { target: { value: 'u2' } });
    const register = within(decisions).getAllByText('Register');
    fireEvent.click(register[register.length - 1]);
    await waitFor(() => expect(calls.some((c) => c.name === 'decide')).toBe(true));
    const decided = calls.find((c) => c.name === 'decide');
    expect(decided?.params).toEqual(['o1', 'billing']);
    expect(decided?.body).toMatchObject({ action: 'register', owner: { kind: 'person', id: 'u2', name: 'Grace' }, capabilities: [] });
  });

  it('says plainly when the backend has no registry', async () => {
    serve({ registry: read('registry', refused(404)) });
    render(<ComponentsScreen bridge={bridgeFor('organization')} />);
    expect(await screen.findByText('no_registry')).toBeTruthy();
  });

  it('Platform › Components lists the platform’s tier and opens a component’s page', async () => {
    render(<ComponentsScreen bridge={bridgeFor('platform')} />);
    fireEvent.click(await screen.findByText('audit'));
    expect(screen.queryByText('billing')).toBeNull();
    expect(await screen.findByText('MIT')).toBeTruthy();
    expect(calls.find((c) => c.name === 'versions')?.params).toEqual({ org: 'o1', crate: 'audit' });
    fireEvent.click(screen.getByText(/back_to_list/));
    expect(await screen.findByText('audit')).toBeTruthy();
  });

  it('offers Repositories & sync to a platform administrator only', async () => {
    const { unmount } = render(<ComponentsScreen bridge={bridgeFor('platform')} />);
    await screen.findByText('audit');
    expect(screen.queryByText('repositories_sync')).toBeNull();
    unmount();
    serve({}, ROOT);
    render(<ComponentsScreen bridge={bridgeFor('platform')} />);
    fireEvent.click(await screen.findByText('repositories_sync'));
    expect(opened).toEqual(['/platform/repositories']);
  });

  it('Publication requests: preview, then publish', async () => {
    const request: PublicationRequest = {
      organization_id: 'o2',
      organization_name: 'Beta',
      name: 'ledger',
      version: '1.0.0',
      requested_by: 'u9',
      requested_by_name: 'Linus',
      at: '2026-11-01T00:00:00Z',
    };
    serve({
      publicationRequests: read('publicationRequests', { items: [request] }),
      answerPublication: write('answerPublication', {
        ...entry('ledger'),
        publish_preview: { repo: 'cf/gears', base_branch: 'main', branch: 'contribute/o2/ledger', path: 'gears/ledger', files: ['a'], skipped: [], title: 't' },
        contribution: { pr_url: 'https://github.com/cf/gears/pull/1' },
      }),
    });
    render(<ComponentsScreen bridge={bridgeFor('publications')} />);
    expect(await screen.findByText('ledger')).toBeTruthy();
    expect((screen.getByText('publish').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('preview'));
    expect(await screen.findByText('Pull request into cf/gears (main) from contribute/o2/ledger')).toBeTruthy();
    fireEvent.click(screen.getByText('publish'));
    await waitFor(() => expect(calls.filter((c) => c.name === 'answerPublication')).toHaveLength(2));
    const [preview, publish] = calls.filter((c) => c.name === 'answerPublication');
    expect(preview.params).toEqual(['o2', 'ledger']);
    expect(preview.body).toEqual({ action: 'publish', dry_run: true, version: '1.0.0' });
    expect(publish.body).toEqual({ action: 'publish', version: '1.0.0' });
  });

  it('Publication requests: a 403 is no access, not an error', async () => {
    serve({ publicationRequests: read('publicationRequests', refused(403)) });
    render(<ComponentsScreen bridge={bridgeFor('publications')} />);
    expect(await screen.findByText('publications_refused')).toBeTruthy();
  });

  it('Repositories: a platform administrator edits and saves the platform’s sources', async () => {
    const { unmount } = render(<ComponentsScreen bridge={bridgeFor('repositories')} />);
    expect(await screen.findByText('platform_sources_admin_only')).toBeTruthy();
    unmount();
    serve({}, ROOT);
    render(<ComponentsScreen bridge={bridgeFor('repositories')} />);
    fireEvent.click(await screen.findByText('add_repository'));
    fireEvent.change(screen.getByLabelText('repository_owner_name'), { target: { value: 'cf/gears-rust' } });
    fireEvent.click(screen.getByText('save'));
    await waitFor(() => expect(calls.some((c) => c.name === 'savePlatformSources')).toBe(true));
    expect(calls.find((c) => c.name === 'savePlatformSources')?.body).toEqual({
      items: [{ tenant: ROOT, connection_id: null, repo: 'cf/gears-rust', git_ref: null, mode: 'gears' }],
      crates_io: 'constructorfabric',
    });
  });
});

describe('the dictionaries', () => {
  it('Russian has every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ru));
    expect(missing).toEqual([]);
  });

  it('every count has its Russian few form', () => {
    const counts = Object.keys(en)
      .filter((k) => k.endsWith('_many') && k.replace(/_many$/, '_one') in en)
      .map((k) => k.replace(/_many$/, '_few'));
    expect(counts.filter((k) => !(k in ru))).toEqual([]);
  });
});
