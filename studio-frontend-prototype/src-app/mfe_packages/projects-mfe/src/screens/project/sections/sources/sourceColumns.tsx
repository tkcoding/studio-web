import React from 'react';
import { Cloud, Upload } from 'lucide-react';
import { useFormatters } from '@gears-frontx/react';
import {
  Button,
  NativeSelect,
  NativeSelectOption,
  VisuallyHidden,
  type DataGridTableColumn,
} from '@gears-frontx/ui-kit';
import { supportsPullRequests, type ShareMode } from '../../../../model/projectSources';
import type { ShareSave } from '../../../../slices/sourceShareSlice';
import type { Refusal, ScreenText } from '@constructor-studio/mfe-shared';
import { useProjectText, useSourcesText } from '../../../../i18n';
import type { SourceRow, SourcesTableRow, UploadsRow } from '../../../../model/sourceRows';
import type { SourceRowActions } from '../../../../shared/useSourceRowActions';
import { useDayTime } from '../../../../shared/dayTime';
import { useDaysAgo } from '../../../../shared/daysAgo';
import { LazyActivitySparkline } from './LazyActivitySparkline';
import { PROVIDER_ICONS } from '../../../../components/providerIcons';
import { SourceRowMenu } from './SourceRowMenu';
import styles from './SourcesSection.module.css';

const MISSING = '—';

export interface SourceColumnDeps {
  t: ScreenText;
  windowDays: number | null;
  actions: SourceRowActions;
  scale: number;
  container?: HTMLElement | null;
  /** The "Changes" saves out or failed, by row id. */
  shareSaves?: Readonly<Record<string, ShareSave>>;
}

const SourceCell: React.FC<{ row: SourceRow; actions: SourceRowActions }> = ({
  row,
  actions,
}) => {
  const Icon = (row.provider && PROVIDER_ICONS[row.provider]) || Cloud;
  const provider = row.provider === null ? null : actions.providerName(row.provider);
  const path = row.branch ? `${row.fullPath} · ${row.branch}` : row.fullPath;
  return (
    <div className={styles.source}>
      <span
        className={styles.providerTile}
        {...(provider === null
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': provider, title: provider })}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className={styles.sourceText}>
        <span className={styles.sourceName} title={row.name}>
          {row.name}
        </span>
        <span className={styles.sourcePath} title={path}>
          {path}
        </span>
      </span>
    </div>
  );
};

SourceCell.displayName = 'SourceCell';

const UploadsCell: React.FC = () => {
  const t = useSourcesText();
  return (
    <div className={styles.source}>
      <span className={styles.providerTile} aria-hidden="true">
        <Upload size={16} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className={styles.sourceText}>
        <span className={styles.sourceName}>{t('uploads_name')}</span>
        <span className={styles.sourcePath}>{t('uploads_note')}</span>
      </span>
    </div>
  );
};

UploadsCell.displayName = 'UploadsCell';

const RoleCell: React.FC<{ row: SourceRow; actions: SourceRowActions }> = ({ row, actions }) =>
  row.provider === null ? (
    <span className={styles.muted}>{MISSING}</span>
  ) : (
    <span className={styles.role}>
      <span className={styles.roleDot} aria-hidden="true" />
      {actions.providerName(row.provider)}
    </span>
  );

RoleCell.displayName = 'RoleCell';

/**
 * The prototype's `SourceShareMode`: how "Share with the team" in the IDE
 * lands edits in this repository, changed in place and saved on change. A
 * pull request is offered only where the source's provider can open one (a
 * source already set to it keeps the choice).
 */
const ShareModeCell: React.FC<{
  row: SourceRow;
  actions: SourceRowActions;
  save: ShareSave | undefined;
}> = ({ row, actions, save }) => {
  const t = useSourcesText();
  const pullRequests = supportsPullRequests(row.provider);
  const saving = !!save && !save.failed;
  return (
    <span className={styles.share}>
      <NativeSelect
        size="sm"
        aria-label={t('share_label', { name: row.name })}
        title={t('share_title')}
        value={saving ? save.mode : row.shareMode}
        disabled={saving}
        onChange={(event) => actions.changeShareMode(row, event.target.value as ShareMode)}
      >
        <NativeSelectOption value="branch">{t('share_branch')}</NativeSelectOption>
        <NativeSelectOption
          value="pull_request"
          disabled={!pullRequests && row.shareMode !== 'pull_request'}
        >
          {pullRequests ? t('share_pull_request') : t('share_pull_request_github_only')}
        </NativeSelectOption>
      </NativeSelect>
      {saving && <span className={styles.syncLine}>{t('share_saving')}</span>}
      {save?.failed && (
        <span className={styles.syncLine} role="status">
          {t('share_not_saved')}
        </span>
      )}
    </span>
  );
};

ShareModeCell.displayName = 'ShareModeCell';

const SpecsCell: React.FC<{ row: SourcesTableRow; actions: SourceRowActions }> = ({
  row,
  actions,
}) => {
  const t = useSourcesText();
  if (row.specs === null || row.specs === 0) {
    return <span className={styles.muted}>{row.specs ?? MISSING}</span>;
  }
  const uploads = row.kind === 'uploads';
  return (
    <Button
      variant="link"
      className={styles.specsLink}
      title={t(uploads ? 'menu_open_uploads' : 'menu_open_specs')}
      onClick={() => (uploads ? actions.openUploads() : actions.openSpecs(row))}
    >
      {row.specs}
    </Button>
  );
};

SpecsCell.displayName = 'SpecsCell';

const PullRequestsCell: React.FC<{
  row: SourceRow;
  scale: number;
  container?: HTMLElement | null;
}> = ({ row, scale, container }) => {
  const t = useSourcesText();
  const daysAgo = useDaysAgo();
  if (row.activity === null) {
    return <span className={styles.prsUnavailable}>{t('prs_unavailable')}</span>;
  }

  const { open, merged, days } = row.activity;
  return (
    <div className={styles.pullRequests}>
      <span className={styles.prCounts}>
        <span className={styles.prOpen}>{t('prs_open', { count: open })}</span>
        <span className={styles.prMerged}>{t('prs_merged', { count: merged })}</span>
      </span>
      <LazyActivitySparkline
        days={days}
        max={scale}
        series={t('chart_series')}
        label={t('chart_label', { counts: days.join(', ') })}
        dayLabel={daysAgo}
        container={container}
      />
    </div>
  );
};

PullRequestsCell.displayName = 'PullRequestsCell';

function reasonText(projectText: ScreenText, reason: Refusal | null): string | undefined {
  if (reason === null) return undefined;
  return reason.kind === 'i18n' ? projectText(reason.key) : reason.text;
}

const LastSyncCell: React.FC<{ row: SourceRow; actions: SourceRowActions }> = ({
  row,
  actions,
}) => {
  const t = useSourcesText();
  const projectText = useProjectText();
  const { formatRelative } = useFormatters();
  const dayTime = useDayTime();
  const { lastSync, sync } = row;

  const first = (): React.ReactNode => {
    switch (lastSync.kind) {
      case 'synced':
        return (
          <span title={formatRelative(lastSync.at)}>{dayTime(lastSync.at)}</span>
        );
      case 'not_synced':
        return <span>{t('last_sync_not_synced')}</span>;
      case 'not_connected':
        return <span>{t('last_sync_not_connected')}</span>;
      case 'unavailable':
        return (
          <span>{t('sync_unavailable', { provider: actions.providerName(lastSync.provider) })}</span>
        );
    }
  };

  const second = (): React.ReactNode => {
    switch (sync.kind) {
      case 'none':
        return null;
      case 'in_flight':
        return (
          <span className={styles.syncLine}>
            {t(sync.cancelling ? 'sync_cancelling' : 'sync_syncing')}
          </span>
        );
      case 'stopped':
        return (
          <span className={styles.syncLine} title={reasonText(projectText, sync.reason)}>
            {t(sync.status === 'cancelled' ? 'sync_cancelled' : 'sync_failed')}
          </span>
        );
    }
  };

  return (
    <div className={styles.lastSync}>
      {first()}
      {second()}
    </div>
  );
};

LastSyncCell.displayName = 'LastSyncCell';

const UploadedAtCell: React.FC<{ row: UploadsRow }> = ({ row }) => {
  const { formatRelative } = useFormatters();
  const dayTime = useDayTime();
  if (row.lastAt === null) return <span className={styles.muted}>{MISSING}</span>;
  return (
    <div className={styles.lastSync}>
      <span title={formatRelative(row.lastAt)}>{dayTime(row.lastAt)}</span>
    </div>
  );
};

UploadedAtCell.displayName = 'UploadedAtCell';

const HiddenHeader: React.FC<{ column: DataGridTableColumn<SourcesTableRow> }> = ({ column }) => (
  <VisuallyHidden>
    {/* The kit types a label as `string | (() => string)`. */}
    {typeof column.label === 'function' ? column.label() : column.label}
  </VisuallyHidden>
);

HiddenHeader.displayName = 'HiddenHeader';

export function sourceColumns({
  t,
  windowDays,
  actions,
  scale,
  container,
  shareSaves,
}: SourceColumnDeps): DataGridTableColumn<SourcesTableRow>[] {
  const windowed = (key: string) =>
    windowDays === null ? t(key) : t.count(`${key}_window`, windowDays);
  return [
    {
      id: 'source',
      label: t('col_source'),
      width: '22.5rem',
      render: (row) =>
        row.kind === 'uploads' ? <UploadsCell /> : <SourceCell row={row} actions={actions} />,
    },
    {
      id: 'role',
      label: t('col_role'),
      width: '12rem',
      render: (row) =>
        row.kind === 'uploads' ? (
          <span className={styles.muted}>{MISSING}</span>
        ) : (
          <RoleCell row={row} actions={actions} />
        ),
    },
    {
      id: 'share',
      label: t('col_share'),
      width: '14rem',
      render: (row) =>
        row.kind === 'uploads' ? (
          <span className={styles.muted}>{MISSING}</span>
        ) : (
          <ShareModeCell row={row} actions={actions} save={shareSaves?.[row.id]} />
        ),
    },
    {
      id: 'specs',
      label: t('col_specs'),
      width: '7rem',
      render: (row) => <SpecsCell row={row} actions={actions} />,
    },
    {
      id: 'pull_requests',
      label: windowed('col_pull_requests'),
      render: (row) =>
        row.kind === 'uploads' ? (
          <span className={styles.prsUnavailable}>{t('not_applicable')}</span>
        ) : (
          <PullRequestsCell row={row} scale={scale} container={container} />
        ),
    },
    {
      id: 'commits',
      label: windowed('col_commits'),
      width: '8.5rem',
      render: (row) =>
        row.kind === 'uploads' || row.activity === null ? (
          <span className={styles.muted}>{MISSING}</span>
        ) : (
          row.activity.commits
        ),
    },
    {
      id: 'last_sync',
      label: t('col_last_sync'),
      width: '8rem',
      render: (row) =>
        row.kind === 'uploads' ? (
          <UploadedAtCell row={row} />
        ) : (
          <LastSyncCell row={row} actions={actions} />
        ),
    },
    {
      id: 'actions',
      label: t('col_actions'),
      width: '3rem',
      headerComponent: HiddenHeader,
      render: (row) => (
        <div className={styles.actionsCell}>
          <SourceRowMenu row={row} actions={actions} container={container} />
        </div>
      ),
    },
  ];
}
