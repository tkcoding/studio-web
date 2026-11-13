import { describe, expect, it } from 'vitest';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import { orderLevelTabs, tabIdOf, tabOrderKey } from './levelTabOrder';

const tab = (id: string, route: string): StudioScreenExtension =>
  ({ id, domain: 'screen', entry: 'e', presentation: { label: id, route, level: 'project' } }) as StudioScreenExtension;

const overview = tab('ext.overview', '/projects/overview');
const specs = tab('ext.specs', '/projects/specs');
const tests = tab('ext.tests', '/tests');
const team = tab('ext.team', '/projects/team');

describe('tabOrderKey', () => {
  it("keeps the prototype's keys for the levels it had", () => {
    expect(tabOrderKey('project')).toBe('project.tabs.order');
    expect(tabOrderKey('workspace')).toBe('workspace.tabs.order');
    expect(tabOrderKey('organization')).toBe('organization.tabs.order');
  });
});

describe('tabIdOf', () => {
  it("is the route's last segment", () => {
    expect(tabIdOf(specs)).toBe('specs');
    expect(tabIdOf(tests)).toBe('tests');
  });

  it('falls back to the extension id', () => {
    expect(tabIdOf(tab('ext.odd', ''))).toBe('ext.odd');
  });
});

describe('orderLevelTabs', () => {
  const items = [overview, specs, tests, team];
  const ids = (stored: string) => orderLevelTabs(items, stored).map((t) => t.extension.id);

  it('keeps the declared order when nothing is stored', () => {
    expect(ids('')).toEqual(['ext.overview', 'ext.specs', 'ext.tests', 'ext.team']);
  });

  it('draws the stored ones in the stored order; one never stored keeps its declared neighbour', () => {
    // overview is first by default and was never stored, so it stays first;
    // tests follows specs, its declared predecessor.
    expect(ids('team,specs')).toEqual(['ext.overview', 'ext.team', 'ext.specs', 'ext.tests']);
  });

  it('skips an id the level no longer has', () => {
    expect(ids('gone,team')).toEqual(['ext.overview', 'ext.specs', 'ext.tests', 'ext.team']);
  });

  it('places a tab the stored order never saw behind its declared predecessor', () => {
    // `tests` arrived with a kit after the order was stored.
    expect(ids('team,overview,specs')).toEqual(['ext.team', 'ext.overview', 'ext.specs', 'ext.tests']);
  });

  it('keeps two tabs that end in the same word apart', () => {
    const other = tab('ext.platform.components', '/platform/components');
    const mine = tab('ext.components', '/components');
    const ordered = orderLevelTabs([other, mine], 'ext.components,components');
    expect(ordered.map((t) => t.extension.id)).toEqual(['ext.components', 'ext.platform.components']);
  });
});
