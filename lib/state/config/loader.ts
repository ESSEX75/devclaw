/** Orchestrates the current three-layer configuration pipeline. */
import path from "node:path";

import { DATA_DIR, PROJECTS_DIRECTORY_NAME, WORKFLOW_FILE_NAME } from "../paths.js";
import { parseProjectSlug } from "../projects/schema.js";
import { readYamlFile } from "./boundary.js";
import { buildDefaultConfig } from "./defaults.js";
import { mergeConfig } from "./merge.js";
import { resolveConfig } from "./resolution.js";
import { parseConfig } from "./schema.js";
import type { DevClawConfig, ResolvedConfig } from "./types.js";

/**
 * Load and resolve built-in, workspace, and optional project configuration layers.
 *
 * @param workspaceDir - Workspace containing the optional workspace layer.
 * @param projectSlug - Canonical project whose optional layer has highest precedence.
 */
export async function loadConfig(workspaceDir: string, projectSlug?: string): Promise<ResolvedConfig> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const layers: DevClawConfig[] = [buildDefaultConfig()];
  const workspacePath = path.join(dataDir, WORKFLOW_FILE_NAME);
  const workspaceRaw = await readYamlFile(workspacePath);

  if (workspaceRaw !== null) layers.push(parseLayer(workspaceRaw, workspacePath));

  if (projectSlug) {
    const projectPath = path.join(
      dataDir,
      PROJECTS_DIRECTORY_NAME,
      parseProjectSlug(projectSlug),
      WORKFLOW_FILE_NAME,
    );
    const projectRaw = await readYamlFile(projectPath);

    if (projectRaw !== null) layers.push(parseLayer(projectRaw, projectPath));
  }

  return resolveConfig(layers.reduce(mergeConfig));
}

/**
 * Validate one unknown YAML value and retain its source path in failures.
 *
 * @param value - Unknown YAML parser output.
 * @param filePath - Source file used for diagnostic context.
 */
function parseLayer(value: unknown, filePath: string): DevClawConfig {
  try {
    return parseConfig(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Invalid config ${filePath}: ${message}`, { cause: error });
  }
}
