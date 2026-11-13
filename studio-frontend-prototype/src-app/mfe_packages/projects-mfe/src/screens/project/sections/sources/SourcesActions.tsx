// @cpt-dod:cpt-studiofrontend-dod-project-sources-connect-overlay:p1
import React from 'react';
import { Network, Plug } from 'lucide-react';
import { useMfeBridge } from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit';
import { openScreen, useEverLoaded } from '@constructor-studio/mfe-shared';
import { useSourcesSectionTranslations, useSourcesText } from '../../../../i18n';
import { openSourcesConnect } from '../../../../actions/sourcesConnectActions';
import { UploadDocumentsButton } from '../../upload/UploadDocumentsButton';

/**
 * Organization › Connections, the `org-connections` kit's screen: where the
 * connections the repositories are picked from are added, tested and changed
 * (the prototype's "Manage connections" on Sources). The shell opens it; with
 * the kit not installed there is no such screen and nothing opens.
 */
export const CONNECTIONS_ROUTE = '/connections';

/** The Sources header's actions */
export const SourcesActions: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { isLoaded } = useSourcesSectionTranslations();
  const everLoaded = useEverLoaded(isLoaded);
  const t = useSourcesText();
  const bridge = useMfeBridge();

  if (!everLoaded) return null;
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Network />}
        title={t('manage_connections_title')}
        onClick={() => openScreen(bridge, CONNECTIONS_ROUTE)}
        data-manage-connections
      >
        {t('manage_connections')}
      </Button>
      <UploadDocumentsButton projectId={projectId} />
      <Button size="sm" icon={<Plug />} onClick={() => openSourcesConnect(bridge)}>
        {t('connect_source')}
      </Button>
    </>
  );
};

SourcesActions.displayName = 'SourcesActions';
