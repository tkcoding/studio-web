/**
 * Sources' "Changes" saves: the mode being written per source row, and
 * whether the write failed (the prototype's `ShareSave`). Nothing for a row at
 * rest.
 */

import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import type { ShareMode } from '../model/projectSources';
import { closeProject, openProject } from './navSlice';

export interface ShareSave {
  mode: ShareMode;
  failed: boolean;
}

export interface SourceShareState {
  /** By source row id (`connection:full_path`). */
  saves: Record<string, ShareSave>;
}

const SLICE_KEY = 'projects/sourceShare' as const;

const initialState: SourceShareState = { saves: {} };

const { slice, shareSaveStarted, shareSaveFailed, shareSaveDone } = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    shareSaveStarted: (
      state: SourceShareState,
      action: ReducerPayload<{ rowId: string; mode: ShareMode }>
    ) => {
      state.saves[action.payload.rowId] = { mode: action.payload.mode, failed: false };
    },
    shareSaveFailed: (state: SourceShareState, action: ReducerPayload<string>) => {
      const save = state.saves[action.payload];
      if (save) save.failed = true;
    },
    shareSaveDone: (state: SourceShareState, action: ReducerPayload<string>) => {
      delete state.saves[action.payload];
    },
  },
  extraReducers: (builder) => {
    builder.addCase(openProject, () => initialState).addCase(closeProject, () => initialState);
  },
});

export const sourceShareSlice = slice;
export { shareSaveStarted, shareSaveFailed, shareSaveDone };
export const SOURCE_SHARE_SLICE_KEY = SLICE_KEY;

declare module '@gears-frontx/react' {
  interface RootState {
    'projects/sourceShare': SourceShareState;
  }
}

export default slice.reducer;
