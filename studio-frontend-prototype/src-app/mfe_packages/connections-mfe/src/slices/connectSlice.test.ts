import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from '../model/connectionDraft';
import connectReducer, {
  editDraft,
  resetForm,
  submitFailed,
  submitStarted,
  submitSucceeded,
} from './connectSlice';

const FILLED = connectReducer(
  undefined,
  editDraft({ provider: 'github', label: 'GitHub', token: 'ghp_secret' })
);

describe('connect form state', () => {
  it('clears the credential on reset — the store outlives the overlay root', () => {
    expect(FILLED.draft.token).toBe('ghp_secret');
    expect(connectReducer(FILLED, resetForm()).draft).toEqual(EMPTY_DRAFT);
  });

  it('clears a previous refusal as soon as the member edits anything', () => {
    const refused = connectReducer(
      FILLED,
      submitFailed({ kind: 'provider', text: 'bad credentials' })
    );
    expect(refused.error).toEqual({ kind: 'provider', text: 'bad credentials' });
    expect(connectReducer(refused, editDraft({ label: 'GitHub 2' })).error).toBeNull();
  });

  it('reports submission so the buttons can go inert', () => {
    const submitting = connectReducer(FILLED, submitStarted());
    expect(submitting.submitting).toBe(true);
    expect(
      connectReducer(submitting, submitFailed({ kind: 'i18n', key: 'error_generic' })).submitting
    ).toBe(false);
  });

  it('leaves the form usable when the write succeeded but the overlay stayed', () => {
    // The unmount action can be refused; without this the dialog would sit
    // disabled with nothing shown to explain why.
    const submitting = connectReducer(FILLED, submitStarted());
    const done = connectReducer(submitting, submitSucceeded());
    expect(done.submitting).toBe(false);
    expect(done.error).toBeNull();
    // The credential stays until the form is next opened — `resetForm` owns that.
    expect(done.draft.token).toBe('ghp_secret');
  });
});
