export type { SetupTemplates } from "./templates.js";
export { loadSetupTemplates } from "./templates.js";
export type { WorkspaceWriteResult } from "./workspace-files.js";
export {
  backupAndWrite,
  ejectDefaults,
  fileExists,
  initializeWorkspaceFiles,
  refreshSystemInstructionFiles,
  resetDefaults,
  scaffoldWorkspace,
} from "./workspace-files.js";
