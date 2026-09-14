/**
 * Exposes the supported persistence API for every consumer outside `lib/state`.
 * Internal state modules import their concrete owners directly to avoid barrel cycles.
 */
export type {
  DevClawConfig,
  LevelOverride,
  ResolvedConfig,
  ResolvedLevelConfig,
  ResolvedRoleConfig,
  ResolvedTimeouts,
  RoleOverride,
  TimeoutConfig,
} from "./config/index.js";
export {
  getConfiguredRoleIds,
  getLevelMaxWorkers,
  getResolvedRole,
  isConfiguredRoleId,
  loadConfig,
} from "./config/index.js";
export type {
  CreatedProviderIssueRef,
  IssueArchiveStore,
  IssueCreationFailure,
  IssueCreationInput,
  IssueCreationOperation,
  IssueCreationStore,
  IssueStateStore,
} from "./issues/index.js";
export {
  archiveIssueState,
  confirmPipelineNotification,
  emptyIssueArchiveStore,
  emptyIssueCreationStore,
  emptyIssueStateStore,
  isIssueCreationReady,
  newIssueCreationIdentity,
  readIssueArchiveStore,
  readIssueCreationStore,
  readIssueStateStore,
  reservePipelineNotification,
  resetIssueStores,
  updateIssueArchiveStore,
  updateIssueCreationStore,
  updateIssueRuntimeRecord,
  updateIssueStateStore,
  withIssueCreationLock,
  withIssueOrchestrationLock,
  writeIssueArchiveStore,
  writeIssueCreationStore,
  writeIssueRoleLevel,
  writeIssueStateStore,
} from "./issues/index.js";
export { DATA_DIR } from "./paths.js";
export type { ProjectsData, ProjectsUpdate } from "./projects/index.js";
export {
  activateWorker,
  deactivateWorker,
  getProject,
  getRoleWorker,
  parseNotificationEndpoint,
  readProjects,
  replaceProjectsForTesting,
  resolveProjectSlug,
  resolveRepoPath,
  updateProjects,
  updateSlot,
} from "./projects/index.js";
export type { SetupTemplates, WorkspaceWriteResult } from "./setup/index.js";
export {
  backupAndWrite,
  ejectDefaults,
  fileExists,
  initializeWorkspaceFiles,
  loadSetupTemplates,
  refreshSystemInstructionFiles,
  resetDefaults,
  scaffoldWorkspace,
} from "./setup/index.js";
