export {
  AGENTS_MD_TEMPLATE,
  DEFAULT_ROLE_INSTRUCTIONS,
  HEARTBEAT_MD_TEMPLATE,
  IDENTITY_MD_TEMPLATE,
  SOUL_MD_TEMPLATE,
  TOOLS_MD_TEMPLATE,
  WORKFLOW_YAML_TEMPLATE,
} from "./templates.js";
export { getCurrentVersion, readVersionFile } from "./version.js";
export type { WorkspaceVersionUpgrade, WorkspaceVersionUpgradeReporter } from "./workspace-files.js";
export { backupAndWrite, ensureDefaultFiles, fileExists, scaffoldWorkspace, writeAllDefaults } from "./workspace-files.js";
