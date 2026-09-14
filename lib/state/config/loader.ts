/** Orchestrates the current three-layer configuration pipeline. */
import path from "node:path";

import { DATA_DIR } from "../paths.js";
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
 * @param projectName - Project whose optional layer has highest precedence.
 */
export async function loadConfig(workspaceDir: string, projectName?: string): Promise<ResolvedConfig> {
  const dataDir = path.join(workspaceDir, DATA_DIR);
  const layers: DevClawConfig[] = [buildDefaultConfig()];
  const workspacePath = path.join(dataDir, "workflow.yaml");
  const workspaceRaw = await readYamlFile(workspacePath);

  if (workspaceRaw !== null) layers.push(parseLayer(workspaceRaw, workspacePath));

  if (projectName) {
    const projectPath = path.join(dataDir, "projects", projectName, "workflow.yaml");
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
