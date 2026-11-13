/**
 * A source's "Changes" on the Sources list (the prototype's `changeShareMode`):
 * the config read fresh, that entry's `share_mode` changed and nothing else,
 * written back — the same read-modify-write attach does. A failed write leaves
 * the row saying "not saved", with the config as it was.
 */

import { eventBus, type AppDispatch, type FrontXApp } from '@gears-frontx/react';
import { withShareMode } from '../model/projectSources';
import { shareSaveDone, shareSaveFailed, shareSaveStarted } from '../slices/sourceShareSlice';
import { writeProjectSources } from './projectSourcesEffects';
import '../events/sourcesConnectEvents';

export function initSourceShareEffects(dispatch: AppDispatch, app: FrontXApp): void {
  eventBus.on('mfe/projects/source-share-mode-requested', (request) => {
    const { projectId, rowId, connectionId, fullPath, mode } = request;
    dispatch(shareSaveStarted({ rowId, mode }));
    writeProjectSources(app, projectId, (sources) =>
      withShareMode(sources, { connection_id: connectionId, full_path: fullPath }, mode)
    ).then(
      () => dispatch(shareSaveDone(rowId)),
      () => dispatch(shareSaveFailed(rowId))
    );
  });
}
