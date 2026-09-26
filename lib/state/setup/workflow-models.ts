/** Persists explicit model patches without replacing unrelated workflow configuration. */
import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { DATA_DIR, WORKFLOW_FILE_NAME } from "../paths.js";
import type { WorkspaceWriteResult } from "./types.js";
import { backupAndWrite } from "./workspace-files.js";

/** Patch role-level models in an existing workflow while preserving comments and backups.
 * @param workspacePath - Workspace whose scaffolded workflow will be updated.
 * @param models - Explicit role and level assignments validated by the application.
 */
export async function writeWorkspaceModels(workspacePath: string, models: Record<string, Record<string, string>>): Promise<WorkspaceWriteResult> {
  const relativePath = path.join(DATA_DIR, WORKFLOW_FILE_NAME);
  const workflowPath = path.join(workspacePath, relativePath);
  const content = await fs.readFile(workflowPath, "utf-8");
  const doc = YAML.parseDocument(content);

  if (doc.errors.length) throw new Error(`Invalid workflow YAML: ${doc.errors[0].message}`);
  let changed = false;

  for (const [role, levels] of Object.entries(models)) {
    for (const [level, model] of Object.entries(levels)) {
      if (model === undefined) continue;
      doc.setIn(["roles", role, "levels", level, "model"], model);
      changed = true;
    }
  }

  if (changed) await backupAndWrite(workflowPath, doc.toString({ lineWidth: 120 }));

  return { written: changed ? [relativePath] : [] };
}
