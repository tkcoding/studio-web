import { describe, expect, it } from 'vitest';
import { closeProject, openProject, selectSection } from './navSlice';
import reducer, {
  setSpecsDocumentType,
  setSpecsFilter,
  setSpecsSearch,
  showSourceSpecs,
  type SpecsFilterState,
} from './specsFilterSlice';

const UNFILTERED: SpecsFilterState = { search: '', filter: 'all', documentType: null };

function narrowed(): SpecsFilterState {
  let state = reducer(undefined, setSpecsSearch('prd'));
  state = reducer(state, setSpecsFilter('with_findings'));
  return reducer(state, setSpecsDocumentType('adr'));
}

describe('the Specs list filter', () => {
  it('starts unfiltered', () => {
    expect(reducer(undefined, { type: '@@init' })).toEqual(UNFILTERED);
  });

  it('keeps what the list sets', () => {
    expect(narrowed()).toEqual({ search: 'prd', filter: 'with_findings', documentType: 'adr' });
  });

  it("shows a source's confirmed specs and drops the type chosen before", () => {
    const state = reducer(narrowed(), showSourceSpecs('acme/web'));

    expect(state).toEqual({ search: 'acme/web', filter: 'type_confirmed', documentType: null });
  });

  it('is kept while moving between sections of the project', () => {
    expect(reducer(narrowed(), selectSection('artifacts'))).toEqual(narrowed());
  });

  it('resets when another project opens', () => {
    expect(reducer(narrowed(), openProject('p-2'))).toEqual(UNFILTERED);
  });

  it('resets when the project closes', () => {
    expect(reducer(narrowed(), closeProject())).toEqual(UNFILTERED);
  });
});
