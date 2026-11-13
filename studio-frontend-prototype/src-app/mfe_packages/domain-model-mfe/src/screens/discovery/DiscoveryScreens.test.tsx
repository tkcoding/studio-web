/**
 * Need and Rules drawn from fixture facts: what each screen shows, its empty
 * state, and that its actions reach their callbacks.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SpecModelFact } from '../../model/spec-model';
import { BUILTIN_METHODS } from '../../model/hypothesis-check';
import { BehaviourScreen, HypothesesScreen, NeedsScreen, RulesScreen } from './DiscoveryScreens';

vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());

afterEach(cleanup);

const f = (kind: SpecModelFact['kind'], subject: string, aspect: string, value: string, text = ''): SpecModelFact => ({
  kind,
  subject,
  aspect,
  value,
  text,
  status: 'active',
  status_because: '',
  source: { path: 'docs/prd/need.md', line_start: 4 },
});

const write = { path: 'docs/discovery.md', branch: 'studio/need', commit_sha: 'abc', pr_url: 'https://example.test/pr/1' };

describe('NeedsScreen', () => {
  const facts = [
    f('role', 'Operator', '', ''),
    f('problem', 'Slow search', 'Operator', 'requests take minutes to find'),
    f('idea', 'Full-text search', 'Slow search', 'Operator'),
  ];

  it('lists each reading with its role and where it was read', () => {
    render(<NeedsScreen facts={facts} onOpenFile={undefined} accepted={() => false} />);
    expect(screen.getByText('Slow search')).toBeTruthy();
    expect(screen.getByText('Full-text search')).toBeTruthy();
    expect(screen.getAllByText('need.md:4').length).toBe(2);
    expect(screen.getAllByText('kind_problem').length).toBeGreaterThan(0);
  });

  it('says nothing is read yet, and still offers to add a material', () => {
    render(<NeedsScreen facts={[]} onOpenFile={undefined} accepted={() => false} onAddMaterial={vi.fn()} />);
    expect(screen.getByText('needs_empty_title')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'paste_material' })).toBeTruthy();
  });

  it('adds a pasted material and proposes only the accepted need', async () => {
    const onAddMaterial = vi.fn().mockResolvedValue(undefined);
    const onPropose = vi.fn().mockResolvedValue(write);
    render(
      <NeedsScreen
        facts={facts}
        onOpenFile={undefined}
        accepted={(x) => x.kind === 'problem'}
        onAddMaterial={onAddMaterial}
        onPropose={onPropose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'paste_material' }));
    fireEvent.change(screen.getByLabelText('material_title'), { target: { value: ' Interview ' } });
    fireEvent.change(screen.getByLabelText('material_content'), { target: { value: 'They wait.' } });
    fireEvent.click(screen.getByRole('button', { name: 'add_and_read' }));
    await waitFor(() => expect(onAddMaterial).toHaveBeenCalledWith('Interview', 'They wait.'));
    await screen.findByText(/^✓ added/);

    fireEvent.click(screen.getByRole('button', { name: /accept_need/ }));
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0][0]).toContain('Slow search');
    expect(onPropose.mock.calls[0][0]).not.toContain('Full-text search');
    expect((await screen.findByText('as_pull_request')).getAttribute('href')).toBe(write.pr_url);
  });
});

describe('HypothesesScreen', () => {
  const benefit = f('benefit', 'Full-text search', 'operators', 'find a request in seconds');

  it('says no benefits are read yet', () => {
    render(
      <HypothesesScreen
        facts={[]}
        stateOf={() => 'unchecked'}
        catalogue={BUILTIN_METHODS}
        checkOf={() => undefined}
        onOpenFile={undefined}
      />
    );
    expect(screen.getByText('hyp_empty_title')).toBeTruthy();
  });

  it('shows the hypothesis and records what checking found', () => {
    const onEvidence = vi.fn().mockResolvedValue(undefined);
    render(
      <HypothesesScreen
        facts={[benefit]}
        stateOf={() => 'unchecked'}
        onEvidence={onEvidence}
        catalogue={BUILTIN_METHODS}
        checkOf={() => undefined}
        onOpenFile={undefined}
      />
    );
    expect(screen.getByText('Full-text search')).toBeTruthy();
    expect(screen.getByText('find a request in seconds')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'expand {"name":"Full-text search"}' }));
    fireEvent.click(screen.getByRole('button', { name: 'evidence_supports' }));
    expect(onEvidence).toHaveBeenCalledWith(benefit, 'supports');
  });

  it('saves the check a member edits', async () => {
    const onSaveCheck = vi.fn().mockResolvedValue(undefined);
    render(
      <HypothesesScreen
        facts={[benefit]}
        stateOf={() => 'unchecked'}
        catalogue={BUILTIN_METHODS}
        checkOf={() => undefined}
        onSaveCheck={onSaveCheck}
        onOpenFile={undefined}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'expand {"name":"Full-text search"}' }));
    fireEvent.change(screen.getByPlaceholderText('criterion_placeholder'), { target: { value: 'under 10 s' } });
    fireEvent.click(screen.getByRole('button', { name: 'save_check' }));
    await waitFor(() => expect(onSaveCheck).toHaveBeenCalledTimes(1));
    expect(onSaveCheck.mock.calls[0][1]).toMatchObject({ criterion: 'under 10 s', timing: null });
  });
});

describe('BehaviourScreen', () => {
  const facts = [
    f('lifecycle', 'Request', 'states', 'draft and approved'),
    f('action', 'Request', 'operator', 'edit the request'),
  ];

  it('says there are no questions without states and actions', () => {
    render(<BehaviourScreen facts={[]} rules={[]} decisionOf={() => undefined} onOpenFile={undefined} />);
    expect(screen.getByText('beh_empty_title')).toBeTruthy();
  });

  it('asks for each action in each state and excludes one with a reason', () => {
    const onExclude = vi.fn().mockResolvedValue(undefined);
    render(<BehaviourScreen facts={facts} rules={[]} decisionOf={() => undefined} onExclude={onExclude} onOpenFile={undefined} />);
    const rows = screen.getAllByRole('button', { name: /^expand/ });
    expect(rows).toHaveLength(2);
    expect(screen.getAllByText('approved').length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);
    fireEvent.change(screen.getByLabelText('exclude_reason'), { target: { value: 'drafts are private' } });
    fireEvent.click(screen.getByRole('button', { name: 'exclude' }));
    expect(onExclude).toHaveBeenCalledTimes(1);
    expect(onExclude.mock.calls[0][1]).toBe('drafts are private');
  });
});

describe('RulesScreen', () => {
  const rules = [
    f('constraint', 'Session', 'limit', 'at most 3 sessions'),
    f('constraint', 'Session', 'limit', 'at least 5 sessions'),
    f('constraint', 'Project', 'who may delete', 'only owners', 'Only owners may delete a project.'),
  ];

  it('checks only accepted rules and shows a conflict', () => {
    render(<RulesScreen facts={rules} accepted={(x) => x.subject === 'Session'} onOpenFile={undefined} />);
    const counts = screen.getByText('kpi_conflicts').parentElement!;
    expect(within(counts).getByText('1')).toBeTruthy();
    expect(within(screen.getByText('kpi_pending').parentElement!).getByText('1')).toBeTruthy();
    expect(screen.getAllByText('outcome_conflict').length).toBe(2);
  });

  it('says no rule is accepted yet', () => {
    render(<RulesScreen facts={rules} accepted={() => false} onOpenFile={undefined} />);
    expect(screen.getByText('rules_empty_title')).toBeTruthy();
  });
});
