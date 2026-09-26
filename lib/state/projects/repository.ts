/**
 * Persists the current projects registry through validated atomic transactions.
 */
import fs from "node:fs/promises";

import { LOCK_FILE_SUFFIX, withFileLock, writeJsonAtomic } from "../persistence/index.js";
import { PROJECTS_LOCK_OPTIONS } from "./const.js";
import { projectsPath } from "./paths.js";
import { parseProjectsData } from "./schema.js";
import type { ProjectsData, ProjectsUpdate } from "./types.js";

/**
 * Read and validate the current projects registry.
 *
 * @param workspaceDir - Workspace containing the registry.
 */
export async function readProjects(workspaceDir: string): Promise<ProjectsData> {
  const filePath = projectsPath(workspaceDir);

  try {
    return parseProjectsData(JSON.parse(await fs.readFile(filePath, "utf-8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Cannot read projects registry ${filePath}: ${message}`, { cause: error });
  }
}

/**
 * Read a registry when present, distinguishing an uninitialized workspace from corruption.
 * Missing files return undefined; permission, parsing, and schema errors still fail.
 * @param workspaceDir - Workspace whose optional registry should be inspected.
 */
export async function readOptionalProjects(workspaceDir: string): Promise<ProjectsData | undefined> {
  try {
    return await readProjects(workspaceDir);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;

    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Apply an immutable registry replacement while holding the workspace lock.
 * A failed callback never writes its candidate state.
 *
 * @param workspaceDir - Workspace containing the registry.
 * @param update - Pure callback returning the complete replacement and result.
 */
export async function updateProjects<T>(
  workspaceDir: string,
  update: (data: Readonly<ProjectsData>) => ProjectsUpdate<T> | Promise<ProjectsUpdate<T>>,
): Promise<T> {
  return withFileLock(`${projectsPath(workspaceDir)}${LOCK_FILE_SUFFIX}`, PROJECTS_LOCK_OPTIONS, async () => {
    const change = await update(await readProjects(workspaceDir));
    const validated = parseProjectsData(change.data);

    await writeJsonAtomic(projectsPath(workspaceDir), validated);

    return change.result;
  });
}
