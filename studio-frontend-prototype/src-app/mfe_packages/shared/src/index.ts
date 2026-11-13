/**
 * The public surface of this package. The `host/`, `connector/`, `errors/` and `i18n/`
 * split inside is an implementation detail — MFEs import from here.
 */

export { useHostChrome, toKitTheme, type HostChrome } from './host/useHostChrome';
export {
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
  STUDIO_SHARED_PROPERTY_CONTEXT_ORGANIZATION,
  STUDIO_SHARED_PROPERTY_SESSION_PROFILE,
  STUDIO_SHARED_PROPERTY_CONTEXT_SECTION,
  STUDIO_SHARED_PROPERTY_CONTEXT_WORKSPACE,
  STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT,
  STUDIO_SHARED_PROPERTY_SPACE_FRAME_URL,
  STUDIO_SHARED_PROPERTY_LIVE_EVENT,
  STUDIO_SHARED_PROPERTY_SCREENS_AVAILABLE,
} from './host/hostProperties';
export {
  isAvailableScreens,
  kitAvailable,
  routeAvailable,
  useScreenAvailability,
  type AvailableScreens,
  type ScreenAvailability,
} from './host/screens';
export { STUDIO_MFE_ENTRY_IFRAME } from './host/hostTypes';
export {
  STUDIO_ACTION_CONTEXT_PUBLISH,
  STUDIO_ACTION_WORKSPACES_PUBLISH,
  STUDIO_ACTION_ARTIFACT_OPEN,
  STUDIO_ACTION_NOTIFY,
  STUDIO_ACTION_SCREEN_OPEN,
  STUDIO_ACTION_PLACE_OPEN,
  openScreen,
  openPlace,
  type StudioPlace,
  STUDIO_ARTIFACT_KINDS,
  STUDIO_NOTICE_KINDS,
  STUDIO_EXTENSION_WORKSPACE_CREATE,
  STUDIO_EXTENSION_CONNECTION_CREATE,
  isStudioArtifactKind,
  sendToHost,
  openOverlay,
  closeOverlay,
  requestFromHost,
  type HostAction,
  type StudioNotice,
  type StudioArtifact,
  type StudioArtifactKind,
  type StudioArtifactRequest,
} from './host/hostActions';
export {
  STUDIO_ACTION_CHAIN_DONE,
  STUDIO_ACTION_CHAIN_FAILED,
  createChainOutcomes,
  type ChainOutcomes,
} from './host/chainOutcome';
export { useNotify } from './host/useNotify';
export { StudioMfeLifecycle } from './mfe/StudioMfeLifecycle';
export { authShared } from './auth/authShared';
export {
  clearSharedAuthSession,
  publishSharedAuthSession,
  readSharedAuthSession,
  type SharedAuthSessionAccessor,
} from './auth/sharedAuthSession';
export { prewarmShadowStyles } from './mfe/shadowStyles';
export { anchorKitThemeOnShadowHost } from './mfe/anchorKitThemeOnShadowHost';
export {
  OrganizationProvider,
  useOrganization,
  type OrganizationRef,
  type OrganizationState,
} from './host/organization';
export {
  WorkspaceProvider,
  useWorkspace,
  type WorkspaceRef,
  type WorkspaceState,
} from './host/workspace';

export {
  ConnectorsApiService,
  CONNECTORS_API_BASE_URL,
  REPOSITORY_PAGE_LIMIT,
  connectionsPath,
  connectionTestPath,
  repositoriesPath,
  sendMessagePath,
  targetsPath,
  type ConnectionsParams,
  type ConnectionTestParams,
  type RepositoriesParams,
  type SendMessageParams,
  type TargetsParams,
} from './connector/ConnectorsApiService';
export {
  SIGN_IN_CALLBACK_PATH,
  callbackParams,
  rememberSignInReturn,
  takeSignInReturn,
  type CallbackParams,
} from './connector/connectionSignIn';
export type {
  ConnectionDto,
  ConnectionListDto,
  ConnectionTestDto,
  CreateConnectionBody,
  NotifyTargetDto,
  NotifyTargetListDto,
  ProviderDto,
  ProviderListDto,
  RemoteRepoDto,
  RemoteRepoListDto,
  SendMessageBody,
  SentMessageDto,
} from './connector/connectorTypes';

export {
  parseProblemDetails,
  refusalFrom,
  refusalReason,
  refusalText,
  violationOfType,
  type ProblemDetails,
  type Refusal,
  type Violation,
} from './errors/problemDetails';

export {
  AccountsApiService,
  ACCOUNTS_API_BASE_URL,
  type CreateTenantBody,
} from './accounts/AccountsApiService';
export {
  TENANT_TYPES,
  CHILDREN_PAGE_LIMIT,
  type Tenant,
  type TenantStatus,
  type Page,
  type Me,
  type User,
  type MetadataEntry,
} from './accounts/accountsTypes';
export {
  childrenPath,
  childrenOfTypePath,
  mePath,
  organizationsPath,
  projectsPath,
  tenantMetadataPath,
  tenantPath,
  tenantUserPath,
  tenantsPath,
  workspacesPath,
} from './accounts/accountsPaths';
export { isNotFound, orNullOnNotFound, responseStatus } from './errors/notFound';
export {
  loadScreenTranslations,
  useEverLoaded,
  type TranslationModule,
  type TranslationModules,
} from './i18n/screenTranslations';
export {
  createScreenTranslations,
  createText,
  screenText,
  type ScreenText,
} from './i18n/screenText';
export { errorMessage } from './errors/message';
export { typeAbsence, type TypeAbsence } from './errors/typeAbsent';
export {
  PROJECT_CONFIG_TYPE,
  type ProjectConfig,
  type ProjectMode,
  type ProjectSource,
  type ProjectStatus,
} from './project/projectConfig';
export { checkoutDirectory, sessionSources, type SessionSource } from './project/sessionSources';
export {
  StudioEventsApiService,
  STUDIO_EVENTS_API_BASE_URL,
  organizationOfStreamUrl,
  type StudioEvent,
  type StudioEventPage,
  type StudioRunEvent,
} from './tasks/StudioEventsApiService';
export {
  StudioTasksApiService,
  STUDIO_TASKS_API_BASE_URL,
  type RunsParams,
  type StudioRun,
  type StudioRunList,
  type StudioRunState,
} from './tasks/StudioTasksApiService';
export { isRunSettled, runCount, runUpdateFromRun, type RunUpdate } from './tasks/runs';
export {
  LIVE_REFRESH_DELAY_MS,
  domainChanged,
  isRunEvent,
  isRunEnding,
  isStudioEvent,
  useLiveStudioEvent,
  useStudioEventRefresh,
} from './tasks/liveEvents';
export {
  applyClient,
  EMPTY_LIST_STATE,
  nextSort,
  readListState,
  URL_CHANGE_EVENT,
  useListState,
  writeListState,
  type ClientFilter,
  type ClientResult,
  type ClientSpec,
  type ListControls,
  type ListState,
  type SortDir,
  type SortState,
} from './lists/listState';
export {
  createRunFollower,
  readCursor,
  type RunFollower,
  type RunFollowerOptions,
} from './tasks/followRuns';

// The Studio domain model at run time (ADR-0066): the shell's model tabs and
// the generic screens that list a type's objects.
export {
  ancestorsOf,
  fieldsOfModel,
  kindOf,
  modelOf,
  relationTarget,
  relationsOfModel,
  type DomainFieldKind,
  type DomainModel,
  type GtsCatalog,
  type GtsId,
  type ModelEntity,
  type ModelField,
  type ModelProperty,
  type ModelRelation,
} from './domain/runtime';
export {
  GENERIC_SECTION_PREFIX,
  SHOWS,
  TAB_LEVELS,
  WORKSPACE_SETTINGS_TYPE,
  genericSection,
  genericTabName,
  hiddenToSave,
  isTabLevel,
  levelSettingsType,
  modelTabs,
  parseHiddenTabs,
  shownTabs,
  withHiddenTabs,
  type ModelTab,
  type TabLevel,
} from './domain/levelTabs';
export {
  LIST_PAGE,
  QUERY_MAX_LIMIT,
  SELF_KEY,
  SYSTEM_BUCKET,
  attributesWrite,
  inputValue,
  listQuery,
  nextSort as nextQuerySort,
  objectQuery,
  parsedValue,
  readableFields,
  selfQuery,
  shownValue,
  tableColumns,
  type DomainMutation,
  type DomainMutationResult,
  type DomainOperation,
  type DomainOrderBy,
  type DomainQueryRequest,
  type DomainQueryResult,
  type DomainQueryRow,
  type DomainRowSet,
  type DomainSelection,
  type SortDirection,
  type SortState as QuerySortState,
} from './domain/domainQuery';
export {
  DomainModelApiService,
  DOMAIN_MODEL_API_BASE_URL,
  domainTypesPath,
  type DomainTypesResponse,
} from './domain/DomainModelApiService';
// People and teams (people-mfe, team-mfe).
export * from './people';
