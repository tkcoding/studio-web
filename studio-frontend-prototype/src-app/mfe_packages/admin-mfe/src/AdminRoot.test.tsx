import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';
import manifest from '../mfe.json';

const { section } = vi.hoisted(() => ({ section: { value: undefined as unknown } }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  useSharedProperty: () => section.value,
}));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
  OrganizationProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('./i18n', () => {
  const t = Object.assign((key: string) => key, { count: (key: string) => key });
  return { useAdminTranslations: () => ({ t, loading: false }) };
});
vi.mock('./screens/admin/OrganizationsSection', () => ({ OrganizationsSection: () => 'organizations' }));
vi.mock('./screens/admin/PeopleSection', () => ({ PeopleSection: () => 'people' }));
vi.mock('./screens/admin/AccessSection', () => ({ AccessSection: () => 'access' }));
vi.mock('./screens/admin/SecretsSection', () => ({ SecretsSection: () => 'secrets' }));
vi.mock('./screens/admin/integrations/IntegrationsSection', () => ({ IntegrationsSection: () => 'integrations' }));
vi.mock('./screens/admin/domain-model/DomainModelSection', () => ({ DomainModelSection: () => 'domain-model' }));
vi.mock('./screens/admin/ObjectsSection', () => ({ ObjectsSection: () => 'objects' }));
vi.mock('./screens/admin/views/ViewsSection', () => ({ ViewsSection: () => 'views' }));
vi.mock('./screens/admin/IdentitiesSection', () => ({ IdentitiesSection: () => 'identities' }));
vi.mock('./screens/admin/TenantsSection', () => ({ TenantsSection: () => 'tenants' }));
vi.mock('./screens/model/ModelScreen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./screens/model/ModelScreen')>()),
  ModelScreen: ({ level, section: at }: { level: string; section: string | null }) => `model:${level}:${at}`,
}));
vi.mock('./screens/admin/SystemSection', () => ({ SystemSection: () => 'system' }));
vi.mock('./screens/admin/ProfileSection', () => ({ ProfileSection: () => 'profile' }));

import { ADMIN_SECTIONS, AdminRoot, ORGANIZATION_SECTIONS } from './AdminRoot';

const bridge = {} as ChildMfeBridge;

describe('AdminRoot', () => {
  it.each(ADMIN_SECTIONS)('shows the %s section the shell names', (name) => {
    section.value = name;
    render(<AdminRoot bridge={bridge} />);
    expect(screen.getByText(name)).toBeTruthy();
  });

  it('falls back to People, where the prototype opened Admin', () => {
    section.value = 'nonsense';
    render(<AdminRoot bridge={bridge} />);
    expect(screen.getByText('people')).toBeTruthy();
  });

  it('has one admin-level extension per section, in the prototype order, with administration always available', () => {
    const all = manifest.extensions.map((e) => e.presentation);
    const shown = all.filter((p) => p.level === 'admin');
    expect(shown.map((p) => p.section)).toEqual([...ADMIN_SECTIONS]);
    expect(shown.every((p) => !('kit' in p))).toBe(true);
    expect(all.find((p) => p.level === 'organization')).toHaveProperty('kit', 'org-connections');
    const orders = shown.map((p) => p.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  // Organization › Connections is the Integrations screen (the prototype
  // rendered `ConnectorsView` for both).
  it('answers Organization › Connections with the Integrations section', () => {
    const others = manifest.extensions
      .filter((e) => !/\.model_/.test(e.id))
      .map((e) => e.presentation)
      .filter((p) => p.level !== 'admin');
    expect(others.map((p) => [p.level, p.route, p.section])).toEqual(
      ORGANIZATION_SECTIONS.map((s) => ['organization', `/${s}`, s])
    );
    section.value = 'connections';
    render(<AdminRoot bridge={bridge} />);
    expect(screen.getByText('integrations')).toBeTruthy();
  });

  // The shell's generic screens (ADR-0066): on each of the three levels an
  // Attributes tab, and a hidden screen answering every `type:` section.
  it('declares Attributes and the model tabs’ screen on the three levels, one group per level', () => {
    const generic = manifest.extensions.filter((e) => /\.model_/.test(e.id)).map((e) => e.presentation);
    expect(generic.map((p) => [p.level, p.route, p.section, 'placement' in p ? p.placement : 'main'])).toEqual(
      ['organization', 'workspace', 'project'].flatMap((level) => [
        [level, `/model-${level}/attributes`, 'attributes', 'main'],
        [level, `/model-${level}/types`, 'type:', 'hidden'],
      ])
    );
    expect(generic.filter((p) => 'sectionPrefix' in p && p.sectionPrefix).map((p) => p.section)).toEqual(['type:', 'type:', 'type:']);
  });

  it.each([
    ['model_workspace', 'attributes', 'model:workspace:attributes'],
    ['model_project', 'type:vendors', 'model:project:type:vendors'],
  ])('mounted as %s, shows the generic screen of its level at %s', (leaf, name, shown) => {
    section.value = name;
    render(<AdminRoot bridge={{ extensionId: `x~constructor_studio.admin.screens.${leaf}.v1` } as ChildMfeBridge} />);
    expect(screen.getByText(shown)).toBeTruthy();
    expect(document.querySelector('[data-admin-section]')?.getAttribute('data-admin-section')).toBe(name);
  });

  // Profile: no tab lists it; the user menu opens it by its route.
  it('answers the hidden Profile screen with the Profile section', () => {
    const profile = manifest.extensions.map((e) => e.presentation).find((p) => p.route === '/profile');
    expect(profile).toMatchObject({ level: 'organization', placement: 'hidden', section: 'profile' });
    expect(profile).not.toHaveProperty('kit');
    section.value = 'profile';
    render(<AdminRoot bridge={bridge} />);
    expect(screen.getByText('profile')).toBeTruthy();
  });
});
