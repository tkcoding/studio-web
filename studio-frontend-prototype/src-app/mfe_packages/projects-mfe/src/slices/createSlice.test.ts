import { describe, expect, it } from 'vitest';
import { MAX_SOURCES, type RepositoryPick } from '../model/projectDraft';
import {
  CREATE_SLICE_KEY,
  chooseConnection,
  chooseProvider,
  clearProvider,
  createWizardSlice,
  pickSource,
  searchRepos,
  submitFailed,
  submitProgress,
  submitStarted,
} from './createSlice';

const reducer = createWizardSlice.reducer;

const pick = (n: number): RepositoryPick => ({
  id: `r-${n}`,
  fullPath: `acme/repo-${n}`,
  cloneUrl: `https://github.com/acme/repo-${n}.git`,
  connectionId: 'c-1',
});

function full() {
  let state = reducer(undefined, { type: '@@init' });
  for (let n = 0; n < MAX_SOURCES; n += 1) state = reducer(state, pickSource(pick(n)));
  return state;
}

describe(`${CREATE_SLICE_KEY}: Back from the repositories`, () => {
  it('returns to the providers and keeps the picks', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, chooseProvider('github'));
    state = reducer(state, chooseConnection('c-1'));
    state = reducer(state, searchRepos('api'));
    state = reducer(
      state,
      pickSource({ id: 'r-1', fullPath: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', connectionId: 'c-1' })
    );

    state = reducer(state, clearProvider());

    expect(state).toMatchObject({ providerId: null, connectionId: null, search: '' });
    expect(state.draft.sources.map((pick) => pick.fullPath)).toEqual(['acme/api']);
  });

  it('drops the refusal, as the dialog does', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, chooseProvider('github'));
    state = reducer(state, submitFailed({ kind: 'i18n', key: 'error_generic' }));

    state = reducer(state, clearProvider());

    expect(state.error).toBeNull();
  });
});

describe(`${CREATE_SLICE_KEY}: the picks at the ceiling`, () => {
  it('refuses one more pick, and keeps the refusal on screen', () => {
    let state = reducer(full(), submitFailed({ kind: 'i18n', key: 'error_generic' }));

    state = reducer(state, pickSource(pick(MAX_SOURCES)));

    expect(state.draft.sources).toHaveLength(MAX_SOURCES);
    expect(state.draft.sources.some((entry) => entry.id === `r-${MAX_SOURCES}`)).toBe(false);
    expect(state.error).not.toBeNull();
  });

  it('still lets a pick be taken back', () => {
    const state = reducer(full(), pickSource(pick(0)));

    expect(state.draft.sources).toHaveLength(MAX_SOURCES - 1);
    expect(state.draft.sources.some((entry) => entry.id === 'r-0')).toBe(false);
  });
});

describe(`${CREATE_SLICE_KEY}: choosing what is already chosen`, () => {
  it('keeps the connection and the search', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, chooseProvider('github'));
    state = reducer(state, chooseConnection('c-1'));
    state = reducer(state, searchRepos('api'));

    state = reducer(state, chooseProvider('github'));
    expect(state).toMatchObject({ providerId: 'github', connectionId: 'c-1', search: 'api' });

    state = reducer(state, chooseConnection('c-1'));
    expect(state).toMatchObject({ connectionId: 'c-1', search: 'api' });
  });
});

describe(`${CREATE_SLICE_KEY}: the server's run`, () => {
  const run = { runId: 'r1', state: 'failed', steps: [{ key: 'tenant', state: 'done' }, { key: 'config', state: 'failed', detail: 'down' }] };

  it('keeps the run as last read after a failure, so the dialog says which step stopped', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, submitStarted());
    state = reducer(state, submitProgress(run));
    state = reducer(state, submitFailed({ kind: 'provider', text: 'down' }));
    expect(state.progress).toEqual(run);
    expect(state.submitting).toBe(false);
  });

  it('starts again from no run when the member creates again', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, submitProgress(run));
    state = reducer(state, submitStarted());
    expect(state.progress).toBeNull();
    expect(state.submitting).toBe(true);
  });
});
