import { describe, expect, it } from 'vitest';
import { PROJECT_CONFIG_TYPE } from '../project/projectConfig';
import {
  WORKSPACE_SETTINGS_TYPE,
  genericSection,
  genericTabName,
  hiddenToSave,
  isTabLevel,
  levelSettingsType,
  modelTabs,
  parseHiddenTabs,
  shownTabs,
  withHiddenTabs,
} from './levelTabs';
import { modelOf } from './runtime';

// The shape the gear stores (ontology.studio.json): a tab is a relation of kind
// `shows` with its target's id in `relation` and its name in `type`.
const model = modelOf({
  can_edit_model: false,
  ontology: {
    entities: [
      {
        id: 'workspace',
        name: 'Workspace',
        properties: [
          { name: 'name', type: 'string' },
          { name: 'projects', type: 'Project', relation: 'project', extends: 'edge', relationType: 'shows', relationLabel: 'Projects' },
          { name: 'about', type: 'Workspace', relation: 'workspace', extends: 'edge', relationType: 'shows', relationLabel: 'Attributes' },
          { name: 'members', type: 'Person', relation: 'person', extends: 'edge', relationType: 'owns' },
          { name: 'cost_centres', type: 'Cost centre', relation: 'cost-centre', extends: 'edge', relationType: 'shows' },
        ],
      },
      { id: 'project', name: 'Project' },
      { id: 'cost-centre', name: 'Cost centre' },
    ],
  },
});

describe("a level's tabs in the Studio domain model", () => {
  it('are the shows relations of its type, in its order, with their labels', () => {
    expect(modelTabs(model, 'workspace')).toEqual([
      { name: 'projects', label: 'Projects', target: 'project' },
      { name: 'about', label: 'Attributes', target: 'workspace' },
      // No label in the model: the name, words apart.
      { name: 'cost_centres', label: 'cost centres', target: 'cost-centre' },
    ]);
  });

  it('are none for a type the model lacks or one with no shows relation', () => {
    expect(modelTabs(model, 'organization')).toEqual([]);
    expect(modelTabs(model, 'project')).toEqual([]);
  });

  it('only the three levels carry them', () => {
    expect(['organization', 'workspace', 'project'].every(isTabLevel)).toBe(true);
    expect(isTabLevel('admin')).toBe(false);
    expect(isTabLevel('platform')).toBe(false);
  });
});

describe('the address of a tab the model adds', () => {
  it('is the section type:<name>, and reads back to the name', () => {
    expect(genericSection('cost_centres')).toBe('type:cost_centres');
    expect(genericTabName(genericSection('cost_centres'))).toBe('cost_centres');
  });

  it('is no tab for any other section, nor for the bare prefix', () => {
    expect(genericTabName('attributes')).toBeNull();
    expect(genericTabName('type:')).toBeNull();
    expect(genericTabName(null)).toBeNull();
  });
});

describe('hidden tabs (the level’s settings document)', () => {
  it('live in the workspace settings above a project, in the project config on one', () => {
    expect(levelSettingsType('organization')).toBe(WORKSPACE_SETTINGS_TYPE);
    expect(levelSettingsType('workspace')).toBe(WORKSPACE_SETTINGS_TYPE);
    expect(levelSettingsType('project')).toBe(PROJECT_CONFIG_TYPE);
  });

  it('are read as the distinct names stored, whatever else the document holds', () => {
    expect(parseHiddenTabs({ hidden_tabs: ['about', 'about', '', 3, 'type:x'], icon: 'x' })).toEqual(['about', 'type:x']);
    expect(parseHiddenTabs({ hidden_tabs: 'about' })).toEqual([]);
    expect(parseHiddenTabs(null)).toEqual([]);
  });

  it('are written into the document without losing its other fields', () => {
    expect(withHiddenTabs({ icon: 'x', hidden_tabs: ['a'] }, ['b'])).toEqual({ icon: 'x', hidden_tabs: ['b'] });
    expect(withHiddenTabs(null, [])).toEqual({ hidden_tabs: [] });
  });

  const tabs = ['projects', 'about', 'types'];
  const id = (t: string) => t;

  it('take tabs away, but never all of them', () => {
    expect(shownTabs(tabs, ['about'], id)).toEqual(['projects', 'types']);
    expect(shownTabs(tabs, tabs, id)).toEqual(tabs);
  });

  it('are saved in the tabs’ order, keeping names this place does not list, refused when none would show', () => {
    expect(hiddenToSave(tabs, new Set(['types', 'projects']))).toEqual(['projects', 'types']);
    // `releases` is a kit's tab not installed here: its hiding is kept.
    expect(hiddenToSave(tabs, new Set(['about']), ['releases', 'about'])).toEqual(['about', 'releases']);
    expect(hiddenToSave(tabs, new Set(tabs))).toBeNull();
  });
});
