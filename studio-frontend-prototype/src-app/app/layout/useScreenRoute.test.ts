import { describe, expect, it } from 'vitest';
import { screen } from '@frontx-test-utils/screenFixture';
import { screenRouteOf } from './useScreenRoute';

const projects = screen('projects.main', '/projects', 'workspace');
const overview = screen('projects.overview', '/projects/overview', 'project', { section: 'overview' });
const artifacts = screen('projects.artifacts', '/projects/artifacts', 'project', { section: 'artifacts' });
const people = screen('people', '/people', 'organization');
const registered = [projects, overview, artifacts, people];

describe('screenRouteOf', () => {
  it('is the route of the section shown, not of the screen that shows it', () => {
    expect(screenRouteOf(registered, projects, 'overview')).toBe('/projects/overview');
    expect(screenRouteOf(registered, projects, 'artifacts')).toBe('/projects/artifacts');
  });

  it('is the mounted screen’s own route without a section of its own', () => {
    expect(screenRouteOf(registered, people, null)).toBe('/people');
    expect(screenRouteOf(registered, people, 'overview')).toBe('/people');
  });

  it('is nothing while nothing is mounted', () => {
    expect(screenRouteOf(registered, undefined, 'overview')).toBeNull();
  });
});
