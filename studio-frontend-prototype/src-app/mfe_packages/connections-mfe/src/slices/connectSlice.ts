// @cpt-dod:cpt-studiofrontend-dod-connection-create-secret:p1
import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { EMPTY_DRAFT, type ConnectionDraft } from '../model/connectionDraft';

export interface ConnectState {
  draft: ConnectionDraft;
  submitting: boolean;
  error: Refusal | null;
}

const SLICE_KEY = 'connections/connect' as const;

const initialState: ConnectState = {
  draft: EMPTY_DRAFT,
  submitting: false,
  error: null,
};

const { slice, resetForm, editDraft, submitStarted, submitSucceeded, submitFailed } = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    // @cpt-begin:cpt-studiofrontend-dod-connection-create-secret:p1:inst-1
    resetForm: (state: ConnectState) => {
      state.draft = EMPTY_DRAFT;
      state.submitting = false;
      state.error = null;
    },
    // @cpt-end:cpt-studiofrontend-dod-connection-create-secret:p1:inst-1
    editDraft: (state: ConnectState, action: ReducerPayload<Partial<ConnectionDraft>>) => {
      state.draft = { ...state.draft, ...action.payload };
      state.error = null;
    },
    submitStarted: (state: ConnectState) => {
      state.submitting = true;
      state.error = null;
    },
    submitSucceeded: (state: ConnectState) => {
      state.submitting = false;
      state.error = null;
    },
    submitFailed: (state: ConnectState, action: ReducerPayload<Refusal>) => {
      state.submitting = false;
      state.error = action.payload;
    },
  },
});

export const connectSlice = slice;
export { resetForm, editDraft, submitStarted, submitSucceeded, submitFailed };
export const CONNECT_SLICE_KEY = SLICE_KEY;

declare module '@gears-frontx/react' {
  interface RootState {
    'connections/connect': ConnectState;
  }
}

export default slice.reducer;
