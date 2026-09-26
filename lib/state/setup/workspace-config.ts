/** Owns workspace configuration reads and explicit scoped default replacement. */
import fs from "node:fs/promises";
import path from "node:path";

import { DATA_DIR, WORKFLOW_FILE_NAME } from "../paths.js";
import { AGENTS_FILE_NAME, PROMPTS_DIRECTORY_NAME, ROLE_PROMPT_FILE_EXTENSION } from "./const.js";
import { loadSetupTemplates } from "./templates.js";
import type { DefaultsScope, WorkflowDocuments, WorkspaceWriteResult } from "./types.js";
import { backupAndWrite, resetDefaults } from "./workspace-files.js";

/** Read both workflow documents without creating missing state.
 * @param workspacePath - Workspace to inspect.
 */
export async function readWorkflowDocuments(workspacePath: string): Promise<WorkflowDocuments> {
  let current: string | null = null;

  try { current = await fs.readFile(path.join(workspacePath, DATA_DIR, WORKFLOW_FILE_NAME), "utf-8"); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  return { current, template: (await loadSetupTemplates()).workflow };
}

/** Replace only the explicitly selected defaults, with recoverable backups.
 * @param workspacePath - Workspace whose selected files will be replaced.
 * @param scope - Exact subset of defaults requested by the application.
 */
export async function resetWorkspaceConfiguration(workspacePath: string, scope: DefaultsScope): Promise<WorkspaceWriteResult> {
  if (scope === "all") return resetDefaults(workspacePath);
  const templates = await loadSetupTemplates();
  const files: Array<[string, string]> = scope === "workflow"
    ? [[path.join(DATA_DIR, WORKFLOW_FILE_NAME), templates.workflow]]
    : Object.entries(templates.roleInstructions).filter(([, content]) => Boolean(content)).map(([role, content]) => [
      path.join(DATA_DIR, PROMPTS_DIRECTORY_NAME, `${role}${ROLE_PROMPT_FILE_EXTENSION}`), content,
    ]);

  for (const [relativePath, content] of files) await backupAndWrite(path.join(workspacePath, relativePath), content);

  return { written: files.map(([relativePath]) => relativePath) };
}

/** Read existing agent instructions for onboarding detection without creating files.
 * @param workspacePath - Workspace whose instructions may be absent.
 */
export async function readWorkspaceAgentInstructions(workspacePath: string): Promise<string | null> {
  try { return await fs.readFile(path.join(workspacePath, AGENTS_FILE_NAME), "utf8"); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
