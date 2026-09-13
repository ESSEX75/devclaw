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
  IssueRuntimeResolution,
  IssueStateStore,
  IssueStateWriteInput,
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
  resolveIssueRuntimeState,
  updateIssueArchiveStore,
  updateIssueCreationStore,
  updateIssueStateStore,
  withIssueCreationLock,
  withIssueOrchestrationLock,
  writeIssueArchiveStore,
  writeIssueCreationStore,
  writeIssueRoleLevel,
  writeIssueRuntimeState,
  writeIssueStateStore,
} from "./issues/index.js";
export { DATA_DIR } from "./paths.js";
export type { ProjectsData } from "./projects/index.js";
export {
  activateWorker,
  deactivateWorker,
  getProject,
  getRoleWorker,
  loadProjectBySlug,
  parseNotificationEndpoint,
  readProjects,
  resolveProjectSlug,
  resolveRepoPath,
  updateSlot,
  writeProjects,
} from "./projects/index.js";
export type { WorkspaceVersionUpgrade, WorkspaceVersionUpgradeReporter } from "./setup/index.js";
export {
  AGENTS_MD_TEMPLATE,
  backupAndWrite,
  DEFAULT_ROLE_INSTRUCTIONS,
  ensureDefaultFiles,
  fileExists,
  getCurrentVersion,
  HEARTBEAT_MD_TEMPLATE,
  IDENTITY_MD_TEMPLATE,
  readVersionFile,
  scaffoldWorkspace,
  SOUL_MD_TEMPLATE,
  TOOLS_MD_TEMPLATE,
  WORKFLOW_YAML_TEMPLATE,
  writeAllDefaults,
} from "./setup/index.js";
