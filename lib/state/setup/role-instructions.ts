/**
 * Resolves project, workspace, and packaged role instructions from state-owned resources.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { isBuiltInRoleId } from "../../domain/index.js";
import { DATA_DIR, PROJECTS_DIRECTORY_NAME } from "../paths.js";
import { isErrnoException } from "../persistence/index.js";
import { parseProjectSlug } from "../projects/schema.js";
import { PROMPTS_DIRECTORY_NAME, ROLE_PROMPT_FILE_EXTENSION } from "./const.js";
import { loadSetupTemplates } from "./templates.js";
import type { RoleInstructionsResult } from "./types.js";

/** Optional diagnostics request for role-instruction resolution. */
type RoleInstructionsOptions = {
  /** Include the selected source path together with resolved content. */
  withSource: true;
};

/**
 * Load role instructions using project, workspace, then packaged precedence.
 *
 * @param workspaceDir - Workspace containing optional instruction overrides.
 * @param projectSlug - Canonical project whose override has highest precedence.
 * @param role - Configured role whose instructions are requested.
 */
export async function loadRoleInstructions(
  workspaceDir: string,
  projectSlug: string,
  role: string,
): Promise<string>;

/**
 * Load role instructions with the source selected by project, workspace, then packaged precedence.
 *
 * @param workspaceDir - Workspace containing optional instruction overrides.
 * @param projectSlug - Canonical project whose override has highest precedence.
 * @param role - Configured role whose instructions are requested.
 * @param options - Requests source diagnostics together with content.
 */
export async function loadRoleInstructions(
  workspaceDir: string,
  projectSlug: string,
  role: string,
  options: RoleInstructionsOptions,
): Promise<RoleInstructionsResult>;

/**
 * Resolve role instructions and optionally retain source diagnostics.
 *
 * @param workspaceDir - Workspace containing optional instruction overrides.
 * @param projectSlug - Canonical project whose override has highest precedence.
 * @param role - Configured role whose instructions are requested.
 * @param options - Optional request for source diagnostics.
 */
export async function loadRoleInstructions(
  workspaceDir: string,
  projectSlug: string,
  role: string,
  options?: RoleInstructionsOptions,
): Promise<string | RoleInstructionsResult> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const roleFileName = `${role}${ROLE_PROMPT_FILE_EXTENSION}`;
  const candidates = [
    path.join(
      dataDir,
      PROJECTS_DIRECTORY_NAME,
      parseProjectSlug(projectSlug),
      PROMPTS_DIRECTORY_NAME,
      roleFileName,
    ),
    path.join(dataDir, PROMPTS_DIRECTORY_NAME, roleFileName),
  ];

  for (const filePath of candidates) {
    const content = await readOptionalInstructionFile(filePath);

    if (content === null) continue;

    return options?.withSource ? { content, source: filePath } : content;
  }

  const packageDefault = isBuiltInRoleId(role)
    ? (await loadSetupTemplates()).roleInstructions[role]
    : undefined;

  if (packageDefault) {
    return options?.withSource
      ? { content: packageDefault, source: "package-default" }
      : packageDefault;
  }

  return options?.withSource ? { content: "", source: null } : "";
}

/**
 * Read one optional instruction file while surfacing non-missing filesystem failures.
 *
 * @param filePath - Candidate instruction file selected by precedence.
 */
async function readOptionalInstructionFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Cannot read role instructions ${filePath}: ${message}`, { cause: error });
  }
}
