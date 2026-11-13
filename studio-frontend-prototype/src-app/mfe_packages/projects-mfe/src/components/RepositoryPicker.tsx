/**
 * The repository picker of the New project wizard and of Connect source.
 * Its strings are the wizard's: a caller loads the `create` dictionary.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-create-many-sources:p1
// @cpt-algo:cpt-studiofrontend-algo-project-create-repos:p2
// @cpt-dod:cpt-studiofrontend-dod-project-sources-picker:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-attached:p1
import React from 'react';
import { Search, Lock, Eye, Plug } from 'lucide-react';
import {
  Button,
  Checkbox,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@gears-frontx/ui-kit';
import { type RemoteRepoDto, useOrganization } from '@constructor-studio/mfe-shared';
import { useProjectCreateText } from '../i18n';
import { useSourceConnections } from '../shared/useConnections';
import { useRepositories } from '../shared/useRepositories';
import { useDebounced } from '../shared/useDebounced';
import { PROVIDER_ICONS } from './providerIcons';
import { repoKey, sourceKey, type RepositoryPick } from '../model/projectDraft';
import styles from './RepositoryPicker.module.css';
import empty from './EmptyState.module.css';

export interface RepositoryPickerProps {
  providerId: string | null;
  onProviderChange: (provider: string) => void;
  connectionId: string | null;
  onConnectionChange: (connectionId: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  picks: readonly RepositoryPick[];
  onToggle: (pick: RepositoryPick) => void;
  /** No more picks fit: the unpicked rows are inert. */
  atCap: boolean;
  isAttached?: (repo: RemoteRepoDto) => boolean;
  attachedLabel?: string;
  noConnectionsAction?: React.ReactNode;
}

type TableProps = Omit<
  RepositoryPickerProps,
  'providerId' | 'onProviderChange' | 'connectionId' | 'onConnectionChange' | 'noConnectionsAction'
> & {
  connectionId: string;
  orgId: string;
  emptyAction?: React.ReactNode;
};

const RepositoryTable: React.FC<TableProps> = ({
  connectionId,
  orgId,
  search,
  onSearchChange,
  picks,
  onToggle,
  atCap,
  isAttached,
  attachedLabel,
  emptyAction,
}) => {
  const t = useProjectCreateText();
  // @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-2
  const { repositories, loading, failed } = useRepositories(
    connectionId,
    orgId,
    useDebounced(search)
  );
  // @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-2

  const pickedKeys = new Set(picks.map(sourceKey));

  // @cpt-begin:cpt-studiofrontend-dod-project-create-many-sources:p1:inst-2
  const toggle = (repo: RemoteRepoDto): void => {
    onToggle({
      id: repo.id,
      fullPath: repo.full_path,
      cloneUrl: repo.clone_url,
      connectionId,
      ...(repo.default_branch ? { defaultBranch: repo.default_branch } : {}),
    });
  };
  // @cpt-end:cpt-studiofrontend-dod-project-create-many-sources:p1:inst-2

  return (
    <div className={styles.repoViewport}>
      <Input
        className={styles.repoSearch}
        type="search"
        value={search}
        icon={<Search size={16} strokeWidth={1.3} />}
        placeholder={t('search_placeholder')}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label={t('search_placeholder')}
      />

      {loading ? (
        <div className={styles.repoRows}>
          <Skeleton className={styles.repoRowSkeleton} />
          <Skeleton className={styles.repoRowSkeleton} />
          <Skeleton className={styles.repoRowSkeleton} />
          <Skeleton className={styles.repoRowSkeleton} />
          <Skeleton className={styles.repoRowSkeleton} />
        </div>
      ) : failed ? (
        <Empty className={styles.empty}>
          <EmptyHeader>
            <EmptyMedia variant="icon" className={empty.media}>
              <Plug strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyDescription className={empty.description}>{t('repos_error')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className={styles.repoScroll}>
          <Table label={t('repos_region')} className={styles.repoTable}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className={styles.repoPickHead}>
                  <span className={styles.srOnly}>{t('col_pick')}</span>
                </TableHead>
                <TableHead scope="col">{t('col_repository')}</TableHead>
                {/* @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-3 */}
                <TableHead scope="col" className={styles.repoVisibilityHead}>
                  {t('col_visibility')}
                </TableHead>
                {/* @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-3 */}
              </TableRow>
            </TableHeader>
            {/* @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-4 */}
            <TableBody>
            {repositories.length === 0 && (
              <TableRow className={styles.repoEmptyRow}>
                <TableCell colSpan={3}>
                  {search.trim() ? (
                    <Empty className={styles.empty}>
                      <EmptyHeader>
                        <EmptyDescription className={empty.description}>{t('repos_no_match')}</EmptyDescription>
                      </EmptyHeader>
                      <EmptyActions>
                        <Button variant="link" onClick={() => onSearchChange('')}>
                          {t('clear_search')}
                        </Button>
                      </EmptyActions>
                    </Empty>
                  ) : (
                    <Empty className={styles.empty}>
                      <EmptyHeader>
                        <EmptyMedia variant="icon" className={empty.media}>
                          <Plug strokeWidth={1.5} />
                        </EmptyMedia>
                        <EmptyTitle className={empty.title}>{t('repos_empty_title')}</EmptyTitle>
                        <EmptyDescription className={empty.description}>{t('repos_empty')}</EmptyDescription>
                      </EmptyHeader>
                      {emptyAction ? <EmptyActions>{emptyAction}</EmptyActions> : null}
                    </Empty>
                  )}
                </TableCell>
              </TableRow>
            )}
            {repositories.map((repo) => {
              const attached = isAttached?.(repo) ?? false;
              const picked = attached || pickedKeys.has(repoKey(connectionId, repo.id));
              const blocked = attached || (atCap && !picked);
              const isPublic = repo.visibility === 'public';
              return (
                <TableRow
                  key={repo.id}
                  data-picked={picked ? '' : undefined}
                  aria-disabled={blocked || undefined}
                  title={attached ? attachedLabel : undefined}
                  onClick={blocked ? undefined : () => toggle(repo)}
                >
                  <TableCell>
                    <Checkbox
                      className={styles.repoCheckbox}
                      checked={picked}
                      disabled={blocked}
                      aria-label={repo.full_path}
                      onClick={(event) => event.preventDefault()}
                      onCheckedChange={() => toggle(repo)}
                    />
                  </TableCell>
                  <TableHead scope="row" className={styles.repoName}>
                    {repo.name}
                  </TableHead>
                  <TableCell className={styles.repoVisibility}>
                    <span className={styles.repoVisibilityInner}>
                      {isPublic ? (
                        <Eye size={12} strokeWidth={1.4} />
                      ) : (
                        <Lock size={12} strokeWidth={1.4} />
                      )}
                      {isPublic ? t('visibility_public') : t('visibility_private')}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
            {/* @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-4 */}
          </Table>
        </div>
      )}
    </div>
  );
};

RepositoryTable.displayName = 'RepositoryTable';

const GITHUB = 'github';

/** The chips' row while the connections load, with the hint under it, so the card keeps its height. */
const CatalogueSkeleton: React.FC<{ providerChosen: boolean }> = ({ providerChosen }) => {
  const t = useProjectCreateText();
  return (
    <>
      <Skeleton className={styles.providersSkeleton} />
      {providerChosen ? null : <p className={styles.hint}>{t('providers_hint')}</p>}
    </>
  );
};

CatalogueSkeleton.displayName = 'CatalogueSkeleton';

const Catalogue: React.FC<RepositoryPickerProps & { orgId: string }> = ({
  orgId,
  providerId,
  onProviderChange,
  connectionId,
  onConnectionChange,
  noConnectionsAction,
  ...table
}) => {
  const t = useProjectCreateText();
  // @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-1
  const { providers, connections, loading, failed, providerName } = useSourceConnections(orgId);
  // @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-1

  if (loading) return <CatalogueSkeleton providerChosen={Boolean(providerId)} />;
  if (failed) return <p className={styles.placeholder}>{t('connections_error')}</p>;
  // @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-1c
  if (connections.length === 0) {
    return (
      <div className={styles.repoViewport}>
        <Empty className={styles.empty}>
          <EmptyHeader>
            <EmptyMedia variant="icon" className={empty.media}>
              <Plug strokeWidth={1.5} />
            </EmptyMedia>
            <EmptyTitle className={empty.title}>{t('connections_empty_title')}</EmptyTitle>
            <EmptyDescription className={empty.description}>{t('connections_empty')}</EmptyDescription>
          </EmptyHeader>
          {noConnectionsAction ? <EmptyActions>{noConnectionsAction}</EmptyActions> : null}
        </Empty>
      </div>
    );
  }
  // @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-1c

  const connected = providers.filter(({ provider }) =>
    connections.some((connection) => connection.provider === provider)
  );
  const own = connections.filter((connection) => connection.provider === providerId);
  const active = own.find((connection) => connection.id === connectionId) ?? own[0];
  const tryGithub =
    providerId !== GITHUB && connected.some(({ provider }) => provider === GITHUB) ? (
      <Button size="sm" className={styles.tryGithub} onClick={() => onProviderChange(GITHUB)}>
        {t('try_github')}
      </Button>
    ) : null;

  return (
    <>
      {/* @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-1a */}
      <ToggleGroup
        variant="steel"
        size="sm"
        className={styles.providers}
        aria-label={t('providers_label')}
        value={providerId ? [providerId] : []}
        onValueChange={(next: string[]) => {
          const [chosen] = next;
          if (chosen) onProviderChange(chosen);
        }}
      >
        {connected.map(({ provider, displayName }) => {
          const Icon = PROVIDER_ICONS[provider] ?? Plug;
          return (
            <ToggleGroupItem key={provider} value={provider} className={styles.provider}>
              <Icon />
              {displayName}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {/* @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-1a */}

      {/* @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-1b */}
      {!active ? <p className={styles.hint}>{t('providers_hint')}</p> : null}
      {/* @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-1b */}

      {/* @cpt-begin:cpt-studiofrontend-algo-project-create-repos:p2:inst-1d */}
      {active && own.length === 1 ? (
        <p className={styles.account}>{`${providerName(active.provider)} · ${active.label}`}</p>
      ) : null}
      {active && own.length > 1 ? (
        <Tabs value={active.id} onValueChange={(value: string) => onConnectionChange(value)}>
          <TabsList variant="line" className={styles.repoTabs}>
            {own.map((connection) => (
              <TabsTrigger key={connection.id} value={connection.id} className={styles.repoTab}>
                {`${providerName(connection.provider)} · ${connection.label}`}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {/* @cpt-end:cpt-studiofrontend-algo-project-create-repos:p2:inst-1d */}

      {active ? (
        <RepositoryTable
          key={active.id}
          connectionId={active.id}
          orgId={orgId}
          emptyAction={tryGithub}
          {...table}
        />
      ) : null}
    </>
  );
};

Catalogue.displayName = 'Catalogue';

export const RepositoryPicker: React.FC<RepositoryPickerProps> = (props) => {
  const t = useProjectCreateText();
  // The provider is the host root's; this is a context read, not a fetch.
  const { org, loading } = useOrganization();

  if (loading) return <CatalogueSkeleton providerChosen={Boolean(props.providerId)} />;
  if (!org) return <p className={styles.placeholder}>{t('error_no_org')}</p>;

  return <Catalogue orgId={org.id} {...props} />;
};

RepositoryPicker.displayName = 'RepositoryPicker';
