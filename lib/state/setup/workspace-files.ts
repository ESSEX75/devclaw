/** Provides explicit create-only, refresh, reset, and scaffold filesystem capabilities for setup. */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { getAllRoleIds } from "../../roles/index.js";
import {
  DATA_DIR,
  PROJECTS_DIRECTORY_NAME,
  PROJECTS_FILE_NAME,
  WORKFLOW_FILE_NAME,
} from "../paths.js";
import {
  AGENTS_FILE_NAME,
  BACKUP_FILE_SUFFIX,
  HEARTBEAT_FILE_NAME,
  IDENTITY_FILE_NAME,
  LOG_DIRECTORY_NAME,
  PROMPTS_DIRECTORY_NAME,
  ROLE_PROMPT_FILE_EXTENSION,
  SOUL_FILE_NAME,
  TOOLS_FILE_NAME,
  USER_FILE_NAME,
} from "./const.js";
import { loadSetupTemplates } from "./templates.js";
import type { WorkspaceWriteResult } from "./types.js";

/**
 * Create the current managed workspace structure and defaults without overwriting existing files.
 *
 * @param workspacePath - Workspace whose missing current files should be created.
 */
export async function initializeWorkspaceFiles(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const dataDir = path.join(workspacePath, DATA_DIR);
  const written: string[] = [];

  await ensureDirectories(dataDir);
  const files: Array<[string, string]> = [
    [path.join(workspacePath, AGENTS_FILE_NAME), templates.agents],
    [path.join(workspacePath, HEARTBEAT_FILE_NAME), templates.heartbeat],
    [path.join(workspacePath, IDENTITY_FILE_NAME), templates.identity],
    [path.join(workspacePath, TOOLS_FILE_NAME), templates.tools],
    [path.join(dataDir, WORKFLOW_FILE_NAME), templates.workflow],
    [path.join(dataDir, PROJECTS_FILE_NAME), `${JSON.stringify({ projects: {} }, null, 2)}\n`],
    ...getAllRoleIds().flatMap((role): Array<[string, string]> => {
      const content = templates.roleInstructions[role];

      return content ? [[path.join(dataDir, PROMPTS_DIRECTORY_NAME, `${role}${ROLE_PROMPT_FILE_EXTENSION}`), content]] : [];
    }),
  ];

  for (const [filePath, content] of files) {
    if (await writeIfMissing(filePath, content)) written.push(path.relative(workspacePath, filePath));
  }

  return { written };
}

/**
 * Replace managed system instruction files through an explicit refresh operation, preserving backups.
 *
 * @param workspacePath - Workspace whose system instructions should be explicitly refreshed.
 */
export async function refreshSystemInstructionFiles(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const files: Array<[string, string]> = [
    [AGENTS_FILE_NAME, templates.agents],
    [HEARTBEAT_FILE_NAME, templates.heartbeat],
    [TOOLS_FILE_NAME, templates.tools],
  ];

  for (const [relativePath, content] of files) await backupAndWrite(path.join(workspacePath, relativePath), content);

  return { written: files.map(([relativePath]) => relativePath) };
}

/**
 * Reset managed defaults to packaged content while preserving prior files as adjacent backups.
 *
 * @param workspacePath - Workspace whose defaults are explicitly reset with recoverable backups.
 */
export async function resetDefaults(workspacePath: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const dataDir = path.join(workspacePath, DATA_DIR);

  await ensureDirectories(dataDir);
  const files: Array<[string, string]> = [
    [path.join(workspacePath, AGENTS_FILE_NAME), templates.agents],
    [path.join(workspacePath, HEARTBEAT_FILE_NAME), templates.heartbeat],
    [path.join(workspacePath, IDENTITY_FILE_NAME), templates.identity],
    [path.join(workspacePath, TOOLS_FILE_NAME), templates.tools],
    [path.join(dataDir, WORKFLOW_FILE_NAME), templates.workflow],
    ...Object.entries(templates.roleInstructions).map(([role, content]): [string, string] => [
      path.join(dataDir, PROMPTS_DIRECTORY_NAME, `${role}${ROLE_PROMPT_FILE_EXTENSION}`),
      content,
    ]),
  ];

  for (const [filePath, content] of files) await backupAndWrite(filePath, content);

  return { written: files.map(([filePath]) => path.relative(workspacePath, filePath)) };
}

/**
 * Scaffold a new agent workspace with create-only identity files and the current managed structure.
 *
 * @param workspacePath - New agent workspace to scaffold.
 * @param defaultWorkspacePath - Optional source for a create-only USER.md copy.
 */
export async function scaffoldWorkspace(workspacePath: string, defaultWorkspacePath?: string): Promise<WorkspaceWriteResult> {
  const templates = await loadSetupTemplates();
  const written: string[] = [];

  if (await writeIfMissing(path.join(workspacePath, SOUL_FILE_NAME), templates.soul)) written.push(SOUL_FILE_NAME);
  if (defaultWorkspacePath) {
    const source = path.join(defaultWorkspacePath, USER_FILE_NAME);

    if (await fileExists(source) && await copyIfMissing(source, path.join(workspacePath, USER_FILE_NAME))) {
      written.push(USER_FILE_NAME);
    }
  }

  const initialized = await initializeWorkspaceFiles(workspacePath);

  return { written: [...written, ...initialized.written] };
}

/**
 * Replace a file while preserving its previous contents in an adjacent `.bak` file.
 *
 * @param filePath - Exact file to replace.
 * @param content - Current packaged content to write.
 */
export async function backupAndWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (await fileExists(filePath)) await fs.copyFile(filePath, `${filePath}${BACKUP_FILE_SUFFIX}`);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Determine whether a filesystem entry currently exists without exposing missing-file errors.
 *
 * @param filePath - Exact path whose existence should be queried.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Create every directory required by current setup and runtime persistence capabilities.
 *
 * @param dataDir - DevClaw data directory whose current structure is required.
 */
async function ensureDirectories(dataDir: string): Promise<void> {
  await Promise.all([
    dataDir,
    path.join(dataDir, PROJECTS_DIRECTORY_NAME),
    path.join(dataDir, PROMPTS_DIRECTORY_NAME),
    path.join(dataDir, LOG_DIRECTORY_NAME),
  ].map((dir) => fs.mkdir(dir, { recursive: true })));
}

/**
 * Write a new file only when its destination does not already exist.
 *
 * @param filePath - Exact create-only destination.
 * @param content - Content written only when the destination is absent.
 */
async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }

  return true;
}

/**
 * Copy one source file only when the destination does not already exist.
 *
 * @param sourcePath - Existing file whose bytes should be copied.
 * @param destinationPath - Create-only destination that must never be overwritten.
 */
async function copyIfMissing(sourcePath: string, destinationPath: string): Promise<boolean> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }

  return true;
}
