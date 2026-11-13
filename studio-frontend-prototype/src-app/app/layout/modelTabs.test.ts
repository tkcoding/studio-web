import { describe, expect, it } from 'vitest';
import type { ModelTab } from '@constructor-studio/mfe-shared';
import { resolveLevelMenu, answersSection, type StudioScreenExtension } from '@/app/mfe/screenLevels';
import { pinFor } from '@/app/pins/usePins';
import { tabIdOf } from '@/app/preferences/levelTabOrder';
import { genericScreenOf, modelNameOf, screenIdOf, visibleTabs, withModelTabs } from './modelTabs';

const ext = (id: string, presentation: Partial<StudioScreenExtension['presentation']>): StudioScreenExtension =>
  ({
    id,
    domain: 'screen',
    entry: presentation.section ? 'entry.shared' : `entry.${id}`,
    presentation: { label: id, route: `/${id}`, ...presentation },
  }) as StudioScreenExtension;

const overview = ext('overview', { level: 'organization', route: '/organization/overview', section: 'overview', order: 10, modelTab: 'org' });
const people = ext('people', { level: 'organization', order: 30 });
const reports = ext('reports', { level: 'organization', order: 70, kit: 'org-reports' });
const attributes = ext('attributes', { level: 'organization', route: '/model-organization/attributes', section: 'attributes', order: 95 });
const settings = ext('settings', { level: 'organization', route: '/organization/settings', section: 'settings', order: 100, placement: 'settings' });
const generic = ext('model.types', {
  level: 'organization',
  label: 'Domain model tab',
  icon: 'lucide:list',
  route: '/model-organization/types',
  section: 'type:',
  sectionPrefix: true,
  placement: 'hidden',
  order: 999,
});
const projectGeneric = { ...generic, id: 'model.project.types', presentation: { ...generic.presentation, level: 'project' as const } };

const registered = [overview, people, reports, attributes, settings, generic, projectGeneric];
const tab = (name: string, label = name, target = 'thing'): ModelTab => ({ name, label, target });

describe("a level's tabs with the Studio domain model's (ADR-0066)", () => {
  // The menu as the manifests and the installed kits give it: Reports' kit is not installed here.
  const menu = resolveLevelMenu(registered, 'organization').filter((e) => e !== reports);

  it('adds a generic tab for every shows relation no screen answers, in the model’s order, before Settings', () => {
    const all = withModelTabs(menu, registered, 'organization', [
      tab('org', 'Overview', 'organization'),
      tab('cost_centres', 'Cost centres'),
      tab('people', 'People', 'person'),
      tab('vendors', 'Vendors'),
    ]);
    // `org` is Overview (its modelTab) and `people` is People: not generic.
    expect(all.map((e) => e.presentation.label)).toEqual(['overview', 'people', 'attributes', 'Cost centres', 'Vendors', 'settings']);
  });

  it('leaves a relation to a kit’s screen to that kit, installed here or not', () => {
    const all = withModelTabs(menu, registered, 'organization', [tab('reports', 'Reports', 'report')]);
    expect(all.map((e) => e.id)).not.toContain('model.types#type:reports');
    expect(all).toHaveLength(menu.length);
  });

  it('adds nothing where the level has no generic screen, or the model nothing', () => {
    expect(withModelTabs(menu, [overview, people], 'organization', [tab('vendors')])).toEqual(menu);
    expect(withModelTabs(menu, registered, 'organization', [])).toEqual(menu);
    expect(withModelTabs([], registered, 'admin', [tab('vendors')])).toEqual([]);
  });

  it('skips a relation that reaches no type', () => {
    const all = withModelTabs(menu, registered, 'organization', [tab('broken', 'Broken', '')]);
    expect(all.map((e) => e.presentation.label)).not.toContain('Broken');
  });

  it('draws a generic tab as its screen under the section type:<name>, with the model’s label and the screen’s icon', () => {
    const [added] = withModelTabs([], registered, 'organization', [tab('vendors', 'Vendors')]);
    expect(added.id).toBe('model.types#type:vendors');
    expect(screenIdOf(added)).toBe('model.types');
    expect(screenIdOf(people)).toBe('people');
    expect(added.presentation).toMatchObject({
      label: 'Vendors',
      icon: 'lucide:list',
      route: '/model-organization/type:vendors',
      section: 'type:vendors',
      placement: 'main',
      level: 'organization',
    });
    // A tab of its own for the person's order, the pins and the hidden tabs.
    expect(tabIdOf(added)).toBe('type:vendors');
    expect(modelNameOf(added)).toBe('type:vendors');
    expect(
      pinFor(added, 'organization', { org: { id: 'o1', name: 'Acme' }, workspace: null, project: null })?.route
    ).toEqual({ token: 'model-organization', org: 'o1', section: 'type:vendors' });
    // The generic screen answers it.
    expect(answersSection(generic, 'type:vendors')).toBe(true);
  });

  it('finds the generic screen of the level asked, not of another', () => {
    expect(genericScreenOf(registered, 'organization')).toBe(generic);
    expect(genericScreenOf(registered, 'project')).toBe(projectGeneric);
    expect(genericScreenOf(registered, 'workspace')).toBeUndefined();
  });
});

describe('the model name of a tab (what hidden_tabs stores)', () => {
  it('is the declared one, else the section, else the route’s last segment', () => {
    expect(modelNameOf(overview)).toBe('org');
    expect(modelNameOf(attributes)).toBe('attributes');
    expect(modelNameOf(people)).toBe('people');
  });

  it('takes the hidden tabs away, but never all of them', () => {
    const all = [overview, people, attributes];
    expect(visibleTabs(all, ['org', 'type:vendors']).map((e) => e.id)).toEqual(['people', 'attributes']);
    expect(visibleTabs(all, ['org', 'people', 'attributes'])).toEqual(all);
  });
});

describe('a section family', () => {
  it('is answered only by a screen that declares its section a prefix', () => {
    expect(answersSection(generic, 'type:')).toBe(true);
    expect(answersSection(generic, 'types')).toBe(false);
    expect(answersSection(attributes, 'attributes')).toBe(true);
    expect(answersSection(attributes, 'attributes2')).toBe(false);
    expect(answersSection(people, 'people')).toBe(false);
  });
});
