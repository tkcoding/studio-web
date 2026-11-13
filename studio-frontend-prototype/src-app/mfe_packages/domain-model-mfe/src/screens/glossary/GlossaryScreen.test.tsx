import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());

import type { GlossaryDoc } from '../../api/types';
import { entitiesOf, type GlossaryEntry, type SpecModelFact } from '../../model/spec-model';
import { GlossaryScreen } from './GlossaryScreen';

const entry = (name: string, facts = 5, extra: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  key: name.toLowerCase(),
  name,
  chosen: false,
  spellings: [name],
  aliases: [],
  facts,
  documents: 2,
  ...extra,
});

const fact = (subject: string, kind: SpecModelFact['kind'], text = `${subject} ${kind}`): SpecModelFact => ({
  kind,
  subject,
  aspect: '',
  value: '',
  text,
  status: 'active',
  status_because: '',
  source: { path: 'docs/prd/members.md', line_start: 3, line_end: 4 },
});

const entries = [entry('member', 20), entry('membership', 15)];
const entities = entitiesOf([fact('Member', 'entity', 'A member is a person in an organization.')]);

function renderScreen(extra: Partial<Parameters<typeof GlossaryScreen>[0]> = {}) {
  const props = {
    entries,
    entities,
    onDecide: vi.fn(() => Promise.resolve()),
    onProposeRename: vi.fn(() =>
      Promise.resolve({ files: ['docs/a.md'], renamed: 3, branch: 'rename', commit_sha: 'abc', pr_url: 'https://pr/1' })
    ),
    onDistinct: vi.fn(() => Promise.resolve()),
    ...extra,
  };
  render(<GlossaryScreen {...props} />);
  return props;
}

describe('GlossaryScreen', () => {
  it('asks for a build while nothing is read', () => {
    renderScreen({ entries: [] });
    expect(screen.getByText('empty_title')).toBeTruthy();
  });

  it('lists each word with the definition a document gives', () => {
    renderScreen();
    expect(screen.getAllByText('A member is a person in an organization.').length).toBeGreaterThan(0);
    expect(screen.getByText('membership')).toBeTruthy();
    // One pair (member / membership) is offered for review.
    expect(screen.getByText('pairs_line {"count":1}')).toBeTruthy();
  });

  it('keeps a pair apart for good when a person says they are different things', async () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /^filter_similar/ }));
    // "-ship" names a standing: the recommendation is to clarify.
    expect(document.querySelector('[data-action="clarify"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'expand {"name":"member / membership"}' }));
    fireEvent.click(screen.getByRole('button', { name: 'action_different' }));
    expect(props.onDistinct).toHaveBeenCalledWith('member', 'membership');
    await waitFor(() => expect(screen.getByText('no_pair_left')).toBeTruthy());
  });

  it('renames a word, then offers to carry the rename into the documents', async () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'expand {"name":"membership"}' }));
    fireEvent.click(screen.getByRole('button', { name: 'rename' }));
    const input = screen.getByRole('textbox', { name: 'name_for {"name":"membership"}' });
    fireEvent.change(input, { target: { value: 'Seat' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(props.onDecide).toHaveBeenCalledWith('membership', { name: 'Seat', alias_of: null });
    const offer = await screen.findByRole('button', { name: 'rename_propose {"from":"membership","to":"Seat"}' });
    fireEvent.click(offer);
    expect(props.onProposeRename).toHaveBeenCalledWith('membership', 'Seat');
    expect(await screen.findByRole('link', { name: 'https://pr/1' })).toBeTruthy();
  });

  it('offers to create the glossary document and proposes the terms kept', async () => {
    const load = vi.fn(() => Promise.resolve<GlossaryDoc>({ found: null, path: 'docs/glossary.md' }));
    const onProposeDocument = vi.fn(() =>
      Promise.resolve({ path: 'docs/glossary.md', branch: 'glossary', commit_sha: 'abc', pr_url: 'https://pr/2' })
    );
    renderScreen({ onLoadDocument: load, onProposeDocument });
    fireEvent.click(await screen.findByRole('button', { name: 'doc_create' }));
    const section = document.querySelector('[data-glossary-doc]') as HTMLElement;
    const submit = within(section).getByRole('button', { name: /^doc_propose/ });
    fireEvent.click(submit);
    await waitFor(() => expect(onProposeDocument).toHaveBeenCalled());
    expect(await within(section).findByRole('link', { name: 'https://pr/2' })).toBeTruthy();
  });
});
