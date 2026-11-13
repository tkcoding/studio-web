import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactRow } from '../../../model/artifact';
import { artifactColumns, type ArtifactColumnLabels, type ArtifactOpen } from './artifactColumns';

/**
 * What a row offers depends on its kind: a file opens in the editor, anything
 * else opens on the forge. The rule is `opensInEditor`; this checks the cells
 * follow it, with the same `onOpen` for the name and the menu item.
 */

const LABELS: ArtifactColumnLabels = {
  name: 'Name',
  repository: 'Repository',
  path: 'Path',
  sync: 'Sync',
  updated: 'Updated',
  ingested: 'Ingested',
  provenance: {},
  actions: (name) => `Actions for ${name}`,
  open: 'Open',
  openInEditor: 'Open in editor',
  copyLink: 'Copy link',
};

const FILE: ArtifactRow = {
  id: 'file-1',
  kind: 'file',
  name: 'README.md',
  repository: 'group/repo',
  path: 'docs/README.md',
  url: null,
  sync: 'ingested',
  updatedAt: null,
  provenance: 'tree',
};

const ISSUE: ArtifactRow = {
  ...FILE,
  id: 'issue-1',
  kind: 'issue',
  name: '#12 Broken link',
  path: 'issues/12',
  url: 'https://forge.example/group/repo/-/issues/12',
  provenance: null,
};

function cells(row: ArtifactRow, onOpen?: ArtifactOpen) {
  const columns = artifactColumns({ labels: LABELS, formatRelative: () => '', onOpen });
  const byKey = new Map(columns.map((column) => [column.key, column]));
  return {
    name: byKey.get('name')!.render(row),
    actions: byKey.get('actions')!.render(row),
  };
}

describe('artifact name cell', () => {
  it('is a button for a file, and hands the row to onOpen', () => {
    const onOpen = vi.fn();
    render(<>{cells(FILE, onOpen).name}</>);

    const button = screen.getByRole('button', { name: 'README.md' });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(FILE, 'name');
    // Native button: reachable by Tab, Enter and Space for free.
    expect(button.tagName).toBe('BUTTON');
  });

  it('stays text for an issue — its home is the forge', () => {
    render(<>{cells(ISSUE, vi.fn()).name}</>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('#12 Broken link')).toBeTruthy();
  });

  it('stays text when nothing can open it', () => {
    render(<>{cells(FILE).name}</>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('artifact row menu', () => {
  it('offers Open in editor for a file, even one without a forge url', async () => {
    const onOpen = vi.fn();
    render(<>{cells(FILE, onOpen).actions}</>);

    const trigger = screen.getByRole('button', { name: 'Actions for README.md' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Open in editor')).toBeTruthy();
    expect(within(menu).queryByText('Open')).toBeNull();
    expect(within(menu).queryByText('Copy link')).toBeNull();

    fireEvent.click(within(menu).getByText('Open in editor'));
    expect(onOpen).toHaveBeenCalledWith(FILE, 'menu');
  });

  it('offers Open and Copy link for an issue', async () => {
    render(<>{cells(ISSUE, vi.fn()).actions}</>);

    fireEvent.click(screen.getByRole('button', { name: 'Actions for #12 Broken link' }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Open')).toBeTruthy();
    expect(within(menu).getByText('Copy link')).toBeTruthy();
    expect(within(menu).queryByText('Open in editor')).toBeNull();
  });

  it('is disabled when the row has neither a path to edit nor a url to visit', () => {
    render(<>{cells({ ...ISSUE, url: null }, vi.fn()).actions}</>);
    const trigger = screen.getByRole('button', { name: /Actions for/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });
});
