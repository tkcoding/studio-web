import { describe, expect, it } from 'vitest';
import { artifactHit, matchPlaces, type Place } from './search';

const ws = (id: string, name: string): Place => ({ kind: 'workspace', id, name, workspaceId: id, workspaceName: name });
const project = (id: string, name: string, w: Place): Place => ({
  kind: 'project',
  id,
  name,
  workspaceId: w.id,
  workspaceName: w.name,
});

const platform = ws('w1', 'Platform');
const web = ws('w2', 'Web studio');
const places = [platform, web, project('p1', 'Studio portal', web), project('p2', 'Billing', platform), project('p3', 'Atlas studio', platform)];

describe('matchPlaces', () => {
  it('lists nothing for an empty query', () => {
    expect(matchPlaces('  ', places)).toEqual([]);
  });

  it('puts a name that starts with the query first, then a word that does, then any containing it', () => {
    expect(matchPlaces('studio', places).map((p) => p.id)).toEqual(['p1', 'w2', 'p3']);
  });

  it('prefers the workspace on a tie, and matches every word, the workspace’s name included', () => {
    expect(matchPlaces('web portal', places).map((p) => p.id)).toEqual(['p1']);
    expect(matchPlaces('platform', places).map((p) => p.id)).toEqual(['w1', 'p3', 'p2']);
  });

  it('is cut at the limit', () => {
    expect(matchPlaces('a', places, 2)).toHaveLength(2);
  });
});

describe('artifactHit', () => {
  const file = (over: Record<string, unknown> = {}) => ({
    type_id: 'gts.cf.studio.artifact.file.v1~',
    instance_id: 'n1',
    value: { path: 'docs/prd.md', project_id: 'p1', workspace_id: 'w2', ...over },
  });

  it('opens a file of a project in the workspace on screen in the IDE', () => {
    const hit = artifactHit(file(), { workspaceId: 'w2' });
    expect(hit).toMatchObject({ kind: 'file', title: 'prd.md', detail: 'docs/prd.md', opens: 'editor', path: 'docs/prd.md' });
  });

  it('opens the project of a file that lives in another workspace', () => {
    expect(artifactHit(file(), { workspaceId: 'w1' }).opens).toBe('project');
  });

  it('opens an issue where it came from, and offers nothing for what cannot be opened', () => {
    const issue = artifactHit(
      { type_id: 'gts.cf.studio.artifact.issue.v1~', instance_id: 'i', value: { number: 7, title: 'Broken', url: 'https://x/7' } },
      { workspaceId: null }
    );
    expect(issue).toMatchObject({ kind: 'issue', title: '#7 Broken', opens: 'link', url: 'https://x/7' });
    expect(artifactHit(file({ project_id: undefined, workspace_id: undefined }), { workspaceId: 'w2' }).opens).toBe('none');
  });
});
