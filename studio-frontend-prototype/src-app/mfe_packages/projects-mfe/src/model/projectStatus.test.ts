import { describe, expect, it } from 'vitest';
import { nextStep, pathProgress, routeFor, type ProjectPathStep, type ProjectStatus } from './projectStatus';

const step = (id: string, state: ProjectPathStep['state']): ProjectPathStep => ({
  step: id,
  title: id,
  state,
  flow: state,
  status: '',
  tab: 'sources',
  action: 'Open Sources',
});

describe('project status', () => {
  it('opens the tabs this portal has, and none it does not', () => {
    expect(routeFor('sources')).toBe('/projects/sources');
    expect(routeFor('releases')).toBe('/releases');
    expect(routeFor('components')).toBe('/product');
    expect(routeFor('ide')).toBe('/space');
    expect(routeFor('model')).toBe('/domain-model');
    expect(routeFor('pulls')).toBeNull();
    // Findings are decided on Issues.
    expect(routeFor('model', 'findings')).toBe('/issues');
  });

  it('counts the steps done', () => {
    expect(pathProgress([step('repos', 'done'), step('types', 'current'), step('model', 'todo')])).toEqual({
      done: 1,
      total: 3,
    });
  });

  it('finds the step the server names as next', () => {
    const status = { next: 'types', path: [step('repos', 'done'), step('types', 'current')] } as ProjectStatus;
    expect(nextStep(status)?.step).toBe('types');
    expect(nextStep({ ...status, next: null })).toBeNull();
  });
});
