/** Provides explicit create-only, refresh, reset, and scaffold filesystem capabilities for setup. */
import fs from "node:fs/promises";
import path from "node:path";

import { getAllRoleIds } from "../../roles/index.js";
import { DATA_DIR } from "../paths.js";
import { loadSetupTemplates } from "./templates.js";

/** Structured record of filesystem paths actually written by a setup capability. */
export type WorkspaceWriteResult = {
  /** Workspace-relative paths created or replaced. */
  written: string[];
};

/** @param workspacePath - Workspace whose missing current files should be created. */
export async function initializeWorkspaceFiles(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const dataDir = path.join(workspacePath, DATA_DIR);
  const written: string[] = [];

  await ensureDirectories(dataDir);
  const files: Array<[string, string]> = [
    [path.join(workspacePath, "AGENTS.md"), templates.agents],
    [path.join(workspacePath, "HEARTBEAT.md"), templates.heartbeat],
    [path.join(workspacePath, "IDENTITY.md"), templates.identity],
    [path.join(workspacePath, "TOOLS.md"), templates.tools],
    [path.join(dataDir, "workflow.yaml"), templates.workflow],
    [path.join(dataDir, "projects.json"), `${JSON.stringify({ projects: {} }, null, 2)}\n`],
    ...getAllRoleIds().flatMap((role): Array<[string, string]> => {
      const content = templates.roleInstructions[role];

      return content ? [[path.join(dataDir, "prompts", `${role}.md`), content]] : [];
    }),
  ];

  for (const [filePath, content] of files) {
    if (await writeIfMissing(filePath, content)) written.push(path.relative(workspacePath, filePath));
  }

  return { written };
}

/** @param workspacePath - Workspace whose system instructions should be explicitly refreshed. */
export async function refreshSystemInstructionFiles(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const files: Array<[string, string]> = [["AGENTS.md", templates.agents], ["HEARTBEAT.md", templates.heartbeat], ["TOOLS.md", templates.tools]];

  for (const [relativePath, content] of files) await backupAndWrite(path.join(workspacePath, relativePath), content);

  return { written: files.map(([relativePath]) => relativePath) };
}

/** @param workspacePath - Workspace that receives only missing packaged defaults. */
export async function ejectDefaults(workspacePath: string): Promise<WorkspaceWriteResult> {
  return initializeWorkspaceFiles(workspacePath);
}

/** @param workspacePath - Workspace whose defaults are explicitly reset with recoverable backups. */
export async function resetDefaults(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const dataDir = path.join(workspacePath, DATA_DIR);

  await ensureDirectories(dataDir);
  const files: Array<[string, string]> = [
    [path.join(workspacePath, "AGENTS.md"), templates.agents], [path.join(workspacePath, "HEARTBEAT.md"), templates.heartbeat],
    [path.join(workspacePath, "IDENTITY.md"), templates.identity], [path.join(workspacePath, "TOOLS.md"), templates.tools],
    [path.join(dataDir, "workflow.yaml"), templates.workflow],
    ...Object.entries(templates.roleInstructions).map(([role, content]): [string, string] => [path.join(dataDir, "prompts", `${role}.md`), content]),
  ];

  for (const [filePath, content] of files) await backupAndWrite(filePath, content);

  return { written: files.map(([filePath]) => path.relative(workspacePath, filePath)) };
}

/**
 * @param workspacePath - New agent workspace to scaffold.
 * @param defaultWorkspacePath - Optional source for a create-only USER.md copy.
 */
export async function scaffoldWorkspace(workspacePath: string, defaultWorkspacePath?: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const written: string[] = [];

  if (await writeIfMissing(path.join(workspacePath, "SOUL.md"), templates.soul)) written.push("SOUL.md");
  if (defaultWorkspacePath && !await fileExists(path.join(workspacePath, "USER.md"))) {
    const source = path.join(defaultWorkspacePath, "USER.md");

    if (await fileExists(source)) {
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.copyFile(source, path.join(workspacePath, "USER.md"));
      written.push("USER.md");
    }
  }

  const initialized = await initializeWorkspaceFiles(workspacePath);

  return { written: [...written, ...initialized.written] };
}

/**
 * Replace a file while preserving its previous contents in an adjacent `.bak` file.
 * @param filePath - Exact file to replace.
 * @param content - Current packaged content to write.
 */
export async function backupAndWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (await fileExists(filePath)) await fs.copyFile(filePath, `${filePath}.bak`);
  await fs.writeFile(filePath, content, "utf-8");
}

/** @param filePath - Exact path whose existence should be queried. */
export async function fileExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath);

 return true; } catch { return false; }
}

/** @param dataDir - DevClaw data directory whose current structure is required. */
async function ensureDirectories(dataDir: string): Promise<void> {
  await Promise.all([dataDir, path.join(dataDir, "projects"), path.join(dataDir, "prompts"), path.join(dataDir, "log")].map((dir) => fs.mkdir(dir, { recursive: true })));
}

/**
 * @param filePath - Exact create-only destination.
 * @param content - Content written only when the destination is absent.
 */
async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await fileExists(filePath)) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");

  return true;
}
