/** The Specs list's filter. */

// @cpt-dod:cpt-studiofrontend-dod-project-specs-filter-state:p1
import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import type { SpecsFilter } from '../model/specsFilter';
import { closeProject, openProject } from './navSlice';

export interface SpecsFilterState {
  search: string;
  filter: SpecsFilter;
  documentType: string | null;
}

const SLICE_KEY = 'projects/specsFilter' as const;

const initialState: SpecsFilterState = {
  search: '',
  filter: 'all',
  documentType: null,
};

const { slice, setSpecsSearch, setSpecsFilter, setSpecsDocumentType, showSourceSpecs } = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    setSpecsSearch: (state: SpecsFilterState, action: ReducerPayload<string>) => {
      state.search = action.payload;
    },
    setSpecsFilter: (state: SpecsFilterState, action: ReducerPayload<SpecsFilter>) => {
      state.filter = action.payload;
    },
    setSpecsDocumentType: (state: SpecsFilterState, action: ReducerPayload<string | null>) => {
      state.documentType = action.payload;
    },
    /** The payload is the repository's `full_path`. */
    showSourceSpecs: (state: SpecsFilterState, action: ReducerPayload<string>) => {
      state.search = action.payload;
      state.filter = 'type_confirmed';
      state.documentType = null;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(openProject, () => initialState).addCase(closeProject, () => initialState);
  },
});

export const specsFilterSlice = slice;
export { setSpecsSearch, setSpecsFilter, setSpecsDocumentType, showSourceSpecs };
export const SPECS_FILTER_SLICE_KEY = SLICE_KEY;

declare module '@gears-frontx/react' {
  interface RootState {
    'projects/specsFilter': SpecsFilterState;
  }
}

export default slice.reducer;
