/** The repository picker's navigation, spread into the wizard's slice and the dialog's */

// @cpt-dod:cpt-studiofrontend-dod-project-sources-picker:p1
import type { ReducerPayload } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { sourceKey, type RepositoryPick } from '../model/projectDraft';

interface PickerState {
  providerId: string | null;
  connectionId: string | null;
  search: string;
  error: Refusal | null;
}

export function pickerReducers<S extends PickerState>() {
  return {
    chooseProvider: (state: S, action: ReducerPayload<string>) => {
      if (state.providerId === action.payload) return;
      state.providerId = action.payload;
      state.connectionId = null;
      state.search = '';
    },
    /** Back from the repositories to the providers; the picks stay. */
    clearProvider: (state: S) => {
      state.providerId = null;
      state.connectionId = null;
      state.search = '';
      state.error = null;
    },
    chooseConnection: (state: S, action: ReducerPayload<string>) => {
      if (state.connectionId === action.payload) return;
      state.connectionId = action.payload;
      state.search = '';
    },
    searchRepos: (state: S, action: ReducerPayload<string>) => {
      state.search = action.payload;
    },
  };
}

/** `picks` with `pick` added, or without it if it was there; `null` when a new pick would pass `cap`. */
export function toggled(
  picks: readonly RepositoryPick[],
  pick: RepositoryPick,
  cap = Infinity
): RepositoryPick[] | null {
  const key = sourceKey(pick);
  const kept = picks.filter((entry) => sourceKey(entry) !== key);
  if (kept.length !== picks.length) return kept;
  return kept.length >= cap ? null : [...kept, pick];
}
