import { describe, expect, it } from 'vitest';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { pinFor } from './usePins';

const screen = (route: string, level: string, section?: string): StudioScreenExtension =>
  ({
    id: `ext${route}`,
    domain: 'screen',
    entry: 'e',
    presentation: { label: 'Label', route, level, ...(section ? { section } : {}) },
  }) as StudioScreenExtension;

const org = { id: 'o1', name: 'Acme' };
const workspace = { id: 'w1', name: 'Work' };
const project = { id: 'p1', name: 'Atlas' };
const context = { org, workspace, project };

describe('pinFor', () => {
  it('keeps the address a tab click writes: an organization section names the organization only', () => {
    expect(pinFor(screen('/people', 'organization'), 'organization', context)).toEqual({
      route: { token: 'people', org: 'o1' },
      label: 'Label',
      where: ['Acme'],
    });
  });

  it('keeps the whole path of a project section, and the section', () => {
    expect(pinFor(screen('/projects/specs', 'project', 'specs'), 'project', context)).toEqual({
      route: { token: 'projects', org: 'o1', workspace: 'w1', project: 'p1', section: 'specs' },
      label: 'Label',
      where: ['Acme', 'Work', 'Atlas'],
    });
  });

  it('keeps the workspace of a workspace section', () => {
    expect(pinFor(screen('/projects', 'workspace'), 'workspace', context)?.route).toEqual({
      token: 'projects',
      org: 'o1',
      workspace: 'w1',
    });
  });

  it('names no organization under a platform section', () => {
    expect(pinFor(screen('/kits', 'platform'), 'platform', context)?.where).toEqual([]);
  });

  it('pins nothing that has no address yet', () => {
    expect(pinFor(screen('/projects/specs', 'project', 'specs'), 'project', { ...context, project: null })).toBeNull();
    expect(pinFor(screen('/projects', 'workspace'), 'workspace', { ...context, workspace: null })).toBeNull();
    expect(pinFor(screen('/Bad Route', 'organization'), 'organization', context)).toBeNull();
  });
});
