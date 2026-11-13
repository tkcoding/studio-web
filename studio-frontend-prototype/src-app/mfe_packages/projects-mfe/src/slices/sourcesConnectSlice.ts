/**
 * Connect source's state: the picks, the search, the chosen connection and the write.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-sources-picker:p1
import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import type { RepositoryPick } from '../model/projectDraft';
import { pickerReducers, toggled } from './pickerReducers';

export interface SourcesConnectState {
  picks: RepositoryPick[];
  providerId: string | null;
  connectionId: string | null;
  search: string;
  submitting: boolean;
  error: Refusal | null;
}

const SLICE_KEY = 'projects/sources-connect' as const;

const initialState: SourcesConnectState = {
  picks: [],
  providerId: null,
  connectionId: null,
  search: '',
  submitting: false,
  error: null,
};

const {
  slice,
  resetConnect,
  togglePick,
  chooseProvider,
  clearProvider,
  chooseConnection,
  searchRepos,
  connectStarted,
  connectFailed,
} = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    resetConnect: () => initialState,
    // The ceiling counts the project's sources too, which only the dialog
    // reads, so the dialog makes the rows inert rather than this refusing.
    togglePick: (state: SourcesConnectState, action: ReducerPayload<RepositoryPick>) => {
      state.picks = toggled(state.picks, action.payload) ?? state.picks;
      state.error = null;
    },
    ...pickerReducers<SourcesConnectState>(),
    connectStarted: (state: SourcesConnectState) => {
      state.submitting = true;
      state.error = null;
    },
    connectFailed: (state: SourcesConnectState, action: ReducerPayload<Refusal>) => {
      state.submitting = false;
      state.error = action.payload;
    },
  },
});

export const sourcesConnectSlice = slice;
export {
  resetConnect,
  togglePick,
  chooseProvider,
  clearProvider,
  chooseConnection,
  searchRepos,
  connectStarted,
  connectFailed,
};
export const SOURCES_CONNECT_SLICE_KEY = SLICE_KEY;

declare module '@gears-frontx/react' {
  interface RootState {
    'projects/sources-connect': SourcesConnectState;
  }
}

export default slice.reducer;
