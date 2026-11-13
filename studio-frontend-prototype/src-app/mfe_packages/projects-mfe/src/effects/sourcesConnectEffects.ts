// @cpt-dod:cpt-studiofrontend-dod-project-sources-write:p1
// @cpt-algo:cpt-studiofrontend-algo-project-sources-attach:p2
import { eventBus, type AppDispatch, type FrontXApp } from '@gears-frontx/react';
import { refusalFrom, type Refusal } from '@constructor-studio/mfe-shared';
import { MAX_SOURCES } from '../model/projectDraft';
import { sourceOf, withSources } from '../model/projectSources';
import { writeProjectSources } from './projectSourcesEffects';
import { recordAttempt } from '../shared/importAttempts';
import { connectFailed, connectStarted } from '../slices/sourcesConnectSlice';
import '../events/sourcesConnectEvents';

/** The config read fresh holds more than the dialog's copy did. */
const TOO_MANY: Refusal = { kind: 'i18n', key: 'error_too_many' };

export function initSourcesConnectEffects(dispatch: AppDispatch, app: FrontXApp): void {
  eventBus.on('mfe/projects/sources-connect-requested', ({ projectId, picks }) => {
    if (picks.length === 0) return;
    dispatch(connectStarted());

    // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-1
    const entries = picks.map(sourceOf);
    // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-1
    // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-2
    recordAttempt(projectId);
    // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-2

    void (async () => {
      try {
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-3
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-4
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-5
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-8
        await writeProjectSources(app, projectId, (sources) => {
          const next = withSources(sources, entries).sources;
          // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-4a
          if (next.length > MAX_SOURCES) throw TOO_MANY;
          // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-4a
          return next;
        });
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-3
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-4
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-5
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-8
      } catch (error) {
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-6
        // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-7
        dispatch(connectFailed(error === TOO_MANY ? TOO_MANY : refusalFrom(error, 'error_write')));
        return;
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-6
        // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-7
      }
      // @cpt-begin:cpt-studiofrontend-algo-project-sources-attach:p2:inst-9
      eventBus.emit('mfe/projects/sources-connected', { projectId });
      // @cpt-end:cpt-studiofrontend-algo-project-sources-attach:p2:inst-9
    })();
  });
}
