import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FRONTX_SHARED_PROPERTY_LANGUAGE, FRONTX_SHARED_PROPERTY_THEME } from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpecModelIssueRow } from '../../api/types';

const { translations, service, scope, sendToHost } = vi.hoisted(() => ({
  translations: vi.fn(),
  scope: { project: 'p1' as string | null, workspace: { id: 'w1' } as { id: string } | null },
  service: {} as Record<string, unknown>,
  sendToHost: vi.fn(),
}));

vi.mock('../../i18n', () => ({ useIssuesTranslations: translations }));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
  useSharedProperty: (id: string) =>
    id.includes('context.project.') ? scope.project : id.includes('context.workspace.') ? scope.workspace : 'default',
}));

vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  sendToHost,
}));

import { IssuesScreen } from './IssuesScreen';

const query = (value: unknown) => () => ({ fetch: () => Promise.resolve(value) });

const finding: SpecModelIssueRow = {
  key: 'f:fp',
  kind: 'finding',
  label: 'Problem',
  group: 'blocks',
  tone: 'bad',
  concern: false,
  title: 'ADR-0040 is cited, but there is no ADR numbered 40',
  hint: 'A document points at something that does not exist.',
  sides: [{ path: 'docs/a.md', line_start: 4, quote: 'See ADR-0040.' }],
  fingerprint: 'fp',
  rule: 'reference.dangling',
  decision: null,
  edit: null,
  decide: [],
  requirement_id: null,
  issue_url: null,
  actions: ['confirm', 'dismiss', 'create_issue'],
  done: false,
};

const assumption: SpecModelIssueRow = {
  ...finding,
  key: 'a:FR-2',
  kind: 'assumption',
  label: 'Assumption',
  group: 'look',
  tone: 'warn',
  title: 'Users sign in with GitHub',
  hint: 'Rests on an assumption.',
  sides: [{ path: 'docs/prd.md', line_start: 9, line_end: 9 }],
  fingerprint: null,
  rule: null,
  requirement_id: 'FR-2',
  issue_url: 'https://github.com/o/r/issues/7',
  actions: ['trace'],
};

function bridge() {
  return createMfeBridgeFixture({
    domainId: 'd',
    instanceId: 'i',
    initialProperties: { [FRONTX_SHARED_PROPERTY_THEME]: 'default', [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'en' },
  }).bridge;
}

const text = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);

describe('IssuesScreen', () => {
  const decide = vi.fn(() => Promise.resolve({ fingerprint: 'fp', decision: 'confirmed' }));
  const createIssue = vi.fn(() => Promise.resolve({ number: 8, url: 'https://github.com/o/r/issues/8' }));
  const review = vi.fn(() => Promise.resolve({ items: [], total: 0 }));
  const issues = vi.fn(() => Promise.resolve({ items: [finding, assumption], total: 2, by_group: { blocks: 1, look: 1 } }));
  const docQuality = vi.fn(
    (): Promise<{ items: unknown[]; total: number; by_kind: Record<string, number> }> =>
      Promise.resolve({
      items: [
        {
          key: 'nd:invoice',
          kind: 'nodefinition',
          label: 'No definition',
          title: 'Invoice has no definition',
          hint: '3 facts describe it.',
          sides: [{ path: 'docs/b.md', line_start: 2 }],
          edit: { name: 'Invoice', definition: 'An Invoice holds total.', fields: [], relations: [] },
          entity: 'invoice',
          issue_url: null,
          actions: ['save_entity', 'create_issue'],
        },
      ],
      total: 1,
      by_kind: { nodefinition: 1 },
    })
  );

  beforeEach(() => {
    translations.mockReturnValue({
      t: Object.assign(text, { count: (key: string, count: number) => `${key} ${count}` }),
      loading: false,
    });
    scope.project = 'p1';
    Object.assign(service, {
      model: query({
        build: { running: false, documents: 2, done: 2, candidates: 0, judged: 0 },
        documents: [{ path: 'docs/a.md', revision: 'r1', state: 'extracted', facts: 0, dropped: 0 }],
        facts: [],
        unread_documents: 0,
      }),
      issues,
      readiness: query({ total: 4, cited: 1, reasoned: 0, open: 2, blocking: 1, ready: false }),
      docQuality,
      buildEstimate: query({ documents: 0 }),
      decideFinding: vi.fn(() => ({ fetch: decide })),
      createIssue: { fetch: createIssue },
      review: { fetch: review },
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("says what stops a build and lists the server's queue with its status", async () => {
    render(<IssuesScreen bridge={bridge()} />);
    expect(await screen.findByText('verdict_blocking 1')).toBeTruthy();
    expect(screen.getByText(/verdict_cited/)).toBeTruthy();
    expect(screen.getByText(/verdict_not_built/)).toBeTruthy();
    expect(screen.getAllByText('kind_problem').length).toBeGreaterThan(0);
    expect(screen.getByText('status_blocks')).toBeTruthy();
    // An issue already opened shows instead of the group, and is not offered again.
    expect(screen.getByText(/issue_number/)).toBeTruthy();
    // The finding and the server's documentation row each offer one.
    expect(screen.getAllByText('create_issue')).toHaveLength(2);
  });

  it("lists the server's documentation rows after the queue, and hides one once its entity is saved", async () => {
    const saveEntity = vi.fn(() =>
      Promise.resolve({ path: 'docs/domain-model.md', branch: 'studio/domain-model', commit_sha: 'abc' })
    );
    Object.assign(service, { saveEntity: vi.fn(() => ({ fetch: saveEntity })) });
    render(<IssuesScreen bridge={bridge()} />);
    fireEvent.click(await screen.findByText('Invoice has no definition'));
    expect(docQuality).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByText('save_definition'));
    await waitFor(() =>
      expect(saveEntity).toHaveBeenCalledWith({
        name: 'Invoice',
        definition: 'An Invoice holds total.',
        fields: [],
        relations: [],
      })
    );
    await waitFor(() => expect(screen.queryByText('Invoice has no definition')).toBeNull());
  });

  it('opens a finding, and a decision on it goes to the server and reads the queue again', async () => {
    render(<IssuesScreen bridge={bridge()} />);
    fireEvent.click(await screen.findByText(finding.title));
    fireEvent.click(screen.getByText('real'));
    await waitFor(() => expect(decide).toHaveBeenCalledWith({ project_id: 'p1', decision: 'confirmed' }));
    expect(service.decideFinding).toHaveBeenCalledWith('fp');
    await waitFor(() => expect(issues).toHaveBeenCalledTimes(2));
    // The passage opens in the editor through the shell.
    fireEvent.click(screen.getByText('docs/a.md:4'));
    expect(sendToHost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'file', path: 'docs/a.md', projectId: 'p1' }) })
    );
  });

  it('opens an issue for a row and records it under the row key', async () => {
    render(<IssuesScreen bridge={bridge()} />);
    // The finding's row first; the documentation's row after it.
    fireEvent.click((await screen.findAllByText('create_issue'))[0]);
    fireEvent.click(screen.getByText('open_issue'));
    await waitFor(() =>
      expect(createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'p1', title: finding.title, assignees: [] })
      )
    );
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith({
        project_id: 'p1',
        items: [{ fact_key: 'iss:f:fp', state: 'opened', path: '', revision: '', note: 'https://github.com/o/r/issues/8' }],
      })
    );
  });

  it('filters by group', async () => {
    render(<IssuesScreen bridge={bridge()} />);
    await screen.findByText(finding.title);
    fireEvent.click(screen.getByText('filter_look'));
    expect(screen.queryByText(finding.title)).toBeNull();
    expect(screen.getByText(assumption.title)).toBeTruthy();
  });

  it('says every reference resolves when nothing is queued and the model is not built', async () => {
    issues.mockResolvedValueOnce({ items: [], total: 0, by_group: { blocks: 0, look: 0 } });
    docQuality.mockResolvedValueOnce({ items: [], total: 0, by_kind: {} });
    render(<IssuesScreen bridge={bridge()} />);
    expect(await screen.findByText('empty_unbuilt')).toBeTruthy();
    expect(screen.getByText('empty_unbuilt_body')).toBeTruthy();
  });

  it('shows why the queue could not be read', async () => {
    issues.mockRejectedValueOnce(new Error('503 the documents gear is down'));
    render(<IssuesScreen bridge={bridge()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('503 the documents gear is down');
  });

  it('asks for a project when none is open', () => {
    scope.project = null;
    render(<IssuesScreen bridge={bridge()} />);
    expect(screen.getByText('no_project')).toBeTruthy();
  });
});
