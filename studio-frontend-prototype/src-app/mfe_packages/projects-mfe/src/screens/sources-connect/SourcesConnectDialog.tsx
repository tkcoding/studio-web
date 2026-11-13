/** Connect source */

// @cpt-dod:cpt-studiofrontend-dod-project-sources-connect-overlay:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-picker:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-attached:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-write:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-no-connection:p1
import React, { useEffect, useMemo } from 'react';
import {
  eventBus,
  useAppDispatch,
  useAppSelector,
  useMfeBridge,
  useSharedProperty,
} from '@gears-frontx/react';
import { Button, Skeleton } from '@gears-frontx/ui-kit';
import {
  OrganizationProvider,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  useEverLoaded,
  useHostChrome,
  type RemoteRepoDto,
} from '@constructor-studio/mfe-shared';
import {
  useProjectCreateScreenTranslations,
  useProjectCreateText,
  useSourcesConnectScreenTranslations,
  useSourcesConnectText,
} from '../../i18n';
import {
  closeSourcesConnect,
  openConnectionForm,
  requestSourcesConnect,
} from '../../actions/sourcesConnectActions';
import {
  SOURCES_CONNECT_SLICE_KEY,
  chooseConnection,
  chooseProvider,
  clearProvider,
  resetConnect,
  searchRepos,
  togglePick,
} from '../../slices/sourcesConnectSlice';
import { useProjectConfig } from '../../shared/useProjectConfig';
import { MAX_SOURCES } from '../../model/projectDraft';
import { repositoryKey } from '../../model/projectSources';
import { RepositoryPicker } from '../../components/RepositoryPicker';
import { SelectionNote } from '../../components/SelectionNote';
import '../../events/sourcesConnectEvents';
import frame from '../../components/OverlayFrame.module.css';

const ConnectForm: React.FC<{ projectId: string }> = ({ projectId }) => {
  const bridge = useMfeBridge();
  const t = useSourcesConnectText();
  const pickerText = useProjectCreateText();
  const dispatch = useAppDispatch();
  const { picks, providerId, connectionId, search, submitting, error } = useAppSelector(
    (state) => state[SOURCES_CONNECT_SLICE_KEY]
  );
  const { config, loading: configLoading, failed: configFailed } = useProjectConfig(projectId);

  const attachedKeys = useMemo(
    () => new Set((config?.sources ?? []).map((source) => repositoryKey(source.clone_url))),
    [config]
  );
  const attachedCount = config?.sources?.length ?? 0;
  const atCap = attachedCount + picks.length >= MAX_SOURCES;
  const isAttached = (repo: RemoteRepoDto): boolean => {
    const key = repositoryKey(repo.clone_url);
    return key !== null && attachedKeys.has(key);
  };
  // Without the attached ones neither the marks nor the ceiling hold.
  const canPick = Boolean(providerId) && !configFailed;

  return (
    <>
      <div className={frame.body}>
        <RepositoryPicker
          providerId={providerId}
          onProviderChange={(provider) => dispatch(chooseProvider(provider))}
          connectionId={connectionId}
          onConnectionChange={(id) => dispatch(chooseConnection(id))}
          search={search}
          onSearchChange={(value) => dispatch(searchRepos(value))}
          picks={picks}
          onToggle={(pick) => dispatch(togglePick(pick))}
          atCap={atCap}
          isAttached={isAttached}
          attachedLabel={t('already_attached')}
          noConnectionsAction={
            <Button variant="outline" size="sm" onClick={() => openConnectionForm(bridge)}>
              {t('add_connection')}
            </Button>
          }
        />
      </div>

      {/* TODO: show errors the way the prototype does, once it has error states. */}
      {(error || configFailed) && (
        <p className={frame.error} role="alert">
          {error
            ? error.kind === 'i18n'
              ? t(error.key)
              : error.text
            : t('error_config')}
        </p>
      )}

      <div className={frame.footer}>
        <div className={frame.footerNote}>
          {!canPick ? null : attachedCount >= MAX_SOURCES ? (
            t('attached_max', { n: MAX_SOURCES })
          ) : (
            <SelectionNote count={picks.length} atCap={atCap} />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            providerId ? dispatch(clearProvider()) : closeSourcesConnect(bridge)
          }
          disabled={submitting}
        >
          {pickerText('back')}
        </Button>
        {canPick ? (
          <Button
            size="sm"
            onClick={() => requestSourcesConnect(projectId, picks)}
            disabled={submitting || configLoading || picks.length === 0}
          >
            {t('connect')}
          </Button>
        ) : null}
      </div>
    </>
  );
};

ConnectForm.displayName = 'ConnectForm';

const ConnectBody: React.FC = () => {
  const bridge = useMfeBridge();
  const { containerRef, dataTheme } = useHostChrome();
  const picker = useProjectCreateScreenTranslations();
  const own = useSourcesConnectScreenTranslations();
  const t = useSourcesConnectText();
  const dispatch = useAppDispatch();
  const published = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);
  const projectId = typeof published === 'string' && published ? published : null;
  const providerId = useAppSelector((state) => state[SOURCES_CONNECT_SLICE_KEY].providerId);

  useEffect(() => {
    dispatch(resetConnect());
  }, [dispatch]);

  useEffect(() => {
    const subscription = eventBus.on('mfe/projects/sources-connected', () =>
      closeSourcesConnect(bridge)
    );
    return () => subscription.unsubscribe();
  }, [bridge]);

  const failed = picker.error ?? own.error;
  const showSkeleton = !useEverLoaded(picker.isLoaded && own.isLoaded) && !failed;

  return (
    <div
      ref={containerRef}
      className={frame.card}
      data-theme={dataTheme}
      data-fit=""
      data-step={providerId ? 'repositories' : 'providers'}
    >
      {showSkeleton ? (
        <Skeleton className={frame.titleSkeleton} />
      ) : (
        <h2 className={frame.title}>{t('title')}</h2>
      )}

      {showSkeleton ? (
        <div className={frame.body}>
          <Skeleton className={frame.bodySkeleton} />
        </div>
      ) : failed ? (
        <p className={frame.error} role="alert">
          Could not load this screen.
        </p>
      ) : projectId ? (
        <ConnectForm projectId={projectId} />
      ) : (
        <p className={frame.error} role="alert">
          {t('error_no_project')}
        </p>
      )}
    </div>
  );
};

ConnectBody.displayName = 'ConnectBody';

export const SourcesConnectDialog: React.FC = () => (
  <OrganizationProvider>
    <ConnectBody />
  </OrganizationProvider>
);

SourcesConnectDialog.displayName = 'SourcesConnectDialog';
