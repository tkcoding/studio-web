import { describe, expect, it } from 'vitest';
import { SCALAR_URL, viewerPage } from './DocsScreen';

describe("the viewer's page", () => {
  const doc = {
    paths: { '/studio-tasks/v1/runs': { get: { tags: ['StudioTasks'], summary: 'say </script> here' } } },
  };

  it('loads the pinned viewer and hands it the description grouped by gear', () => {
    const page = viewerPage(doc, false);
    expect(page).toContain(SCALAR_URL);
    expect(page).toContain('x-tagGroups');
    expect(page).toContain('Studio · Tasks');
  });

  it('never lets the description end its script', () => {
    const page = viewerPage(doc, true);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page).toContain('"darkMode":true');
  });
});
