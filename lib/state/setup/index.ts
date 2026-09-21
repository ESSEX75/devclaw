/** Exposes supported workspace setup and instruction-loading capabilities to the state package. */
export { loadRoleInstructions } from "./role-instructions.js";
export { loadSetupTemplates } from "./templates.js";
export {
  backupAndWrite,
  fileExists,
  initializeWorkspaceFiles,
  refreshSystemInstructionFiles,
  resetDefaults,
  scaffoldWorkspace,
} from "./workspace-files.js";
