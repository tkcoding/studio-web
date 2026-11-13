import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxSourceCount } from '../../inbox/model';

const { group } = vi.hoisted(() => ({ group: { props: [] as Record<string, unknown>[] } }));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  t.count = (key: string, count: number) => `${key} ${count}`;
  return { useOverviewTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useOrganization: () => ({ org: { id: 'o1', name: 'Acme' }, loading: false, failed: false }),
}));

const sources: InboxSourceCount[] = [
  { source: 'review-requests', kit: null, count: 2 },
  { source: 'kit:project-lifecycle/phase-waiting', kit: { slug: 'project-lifecycle', name: 'Project lifecycle', version: '1' }, count: 1 },
];

// The list has its own test (InboxGroup.test.tsx): here it reports what it read.
vi.mock('../overview/InboxGroup', async () => {
  const { useEffect } = await import('react');
  return {
    InboxGroup: (props: {
      onCount?: (n: number) => void;
      onSources?: (s: InboxSourceCount[]) => void;
      onFailed?: (f: boolean) => void;
      only?: string | null;
      reloadKey?: number;
    }) => {
      group.props.push(props as Record<string, unknown>);
      const { onFailed, onCount, onSources, reloadKey } = props;
      useEffect(() => {
        onFailed?.(false);
        onCount?.(3);
        onSources?.(sources);
      }, [onFailed, onCount, onSources, reloadKey]);
      return <div data-inbox-list data-only={props.only ?? ''} />;
    },
  };
});

import { INBOX_PAGE_REREAD_MS, InboxScreen, sourceLabel } from './InboxScreen';

const last = () => group.props[group.props.length - 1]!;

describe('InboxScreen', () => {
  beforeEach(() => {
    group.props = [];
  });
  afterEach(() => vi.useRealTimers());

  it('says how many wait and offers a chip per source, by its kit name or its own word', async () => {
    render(<InboxScreen />);
    expect(await screen.findByText('inbox_status_waiting {"count":3}')).toBeTruthy();
    expect(screen.getByRole('button', { name: /inbox_everything/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /inbox_source_reviews/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: /Project lifecycle/ })).toBeTruthy();
  });

  it('filters the list by the chip picked, and back', async () => {
    render(<InboxScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Project lifecycle/ }));
    expect(last().only).toBe('kit:project-lifecycle/phase-waiting');
    fireEvent.click(screen.getByRole('button', { name: /Project lifecycle/ }));
    expect(last().only).toBeNull();
  });

  it('reads again on Refresh and every two minutes', async () => {
    vi.useFakeTimers();
    render(<InboxScreen />);
    const before = last().reloadKey as number;
    fireEvent.click(screen.getByRole('button', { name: 'inbox_refresh' }));
    expect(last().reloadKey).toBe(before + 1);
    act(() => vi.advanceTimersByTime(INBOX_PAGE_REREAD_MS));
    expect(last().reloadKey).toBe(before + 2);
  });

  it("names the shell's own sources in the person's words and a kit's by the kit", () => {
    const t = ((key: string) => key) as never;
    expect(sourceLabel({ source: 'pull-requests', kit: null, count: 1 }, t)).toBe('inbox_source_pulls');
    // Studio's own two name their kit (ADR-0070 §7) and keep their own words.
    const git = { slug: 'project-git', name: 'Git', version: '1.0.0' };
    expect(sourceLabel({ source: 'pull-requests', kit: git, count: 1 }, t)).toBe('inbox_source_pulls');
    expect(sourceLabel(sources[1]!, t)).toBe('Project lifecycle');
    expect(sourceLabel({ source: 'kit:x/y', kit: null, count: 1 }, t)).toBe('kit:x/y');
  });
});
