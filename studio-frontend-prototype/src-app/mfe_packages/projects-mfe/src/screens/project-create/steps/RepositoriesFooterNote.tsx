// @cpt-dod:cpt-studiofrontend-dod-project-create-many-sources:p1
import React from 'react';
import { useAppSelector } from '@gears-frontx/react';
import { SelectionNote } from '../../../components/SelectionNote';
import { MAX_SOURCES } from '../../../model/projectDraft';
import { CREATE_SLICE_KEY } from '../../../slices/createSlice';

export const RepositoriesFooterNote: React.FC = () => {
  const count = useAppSelector((state) => state[CREATE_SLICE_KEY].draft.sources.length);

  return <SelectionNote count={count} atCap={count >= MAX_SOURCES} />;
};

RepositoriesFooterNote.displayName = 'RepositoriesFooterNote';
