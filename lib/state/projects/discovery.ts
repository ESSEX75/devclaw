/** Inspects whether an SDK-resolved workspace has a valid managed project registry. */

import fs from "node:fs/promises";

import { readOptionalProjects } from "./repository.js";
import type { ProjectsData } from "./types.js";

/** Canonicalize an existing workspace and read its optional strict registry.
 * Missing registries are uninitialized; malformed or inaccessible registries fail.
 * @param workspaceDir - Workspace resolved for a configured agent by the SDK.
 */
export async function inspectManagedWorkspace(workspaceDir: string): Promise<{ workspace: string; projects: ProjectsData | undefined }> {
  const workspace = await fs.realpath(workspaceDir);

  return { workspace, projects: await readOptionalProjects(workspace) };
}
