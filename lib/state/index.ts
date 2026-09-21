/**
 * Exposes the supported persistence API for every consumer outside `lib/state`.
 * Internal state modules import their concrete owners directly to avoid barrel cycles.
 */
export type {
  ResolvedConfig,
  ResolvedRoleConfig,
  ResolvedTimeouts,
} from "./config/index.js";
export {
  getConfiguredRoleIds,
  getLevelMaxWorkers,
  isConfiguredRoleId,
  loadConfig,
} from "./config/index.js";
export type {
  IssueArchiveStore,
  IssueCreationFailure,
  IssueCreationOperation,
  IssueStateStore,
} from "./issues/index.js";
export {
  archiveIssueState,
  confirmPipelineNotification,
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
  writeIssueRoleLevel,
} from "./issues/index.js";
export { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "./paths.js";
export type { ProjectsData } from "./projects/index.js";
export {
  activateWorker,
  deactivateWorker,
  getProject,
  getRoleWorker,
  parseNotificationEndpoint,
  parseProjectSlug,
  readProjects,
  resolveRepoPath,
  updateProjects,
  updateSlot,
} from "./projects/index.js";
export {
  backupAndWrite,
  fileExists,
  initializeWorkspaceFiles,
  loadRoleInstructions,
  loadSetupTemplates,
  refreshSystemInstructionFiles,
  resetDefaults,
  scaffoldWorkspace,
} from "./setup/index.js";
