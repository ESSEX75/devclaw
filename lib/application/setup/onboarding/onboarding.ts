/** Selects onboarding scenarios from read-only workspace and plugin configuration evidence. */

import { loadConfig, readWorkspaceAgentInstructions } from "../../../state/index.js";
import type { ModelConfig } from "../types.js";
import { ONBOARDING_MODE, WORKSPACE_INSTRUCTION_MARKERS } from "./const.js";
import { buildOnboardToolContext, buildReconfigContext } from "./onboarding-instructions.js";
import type { OnboardingMode } from "./types.js";

/** Detect whether plugin configuration has been supplied.
 * @param pluginConfig - Current optional plugin configuration.
 */
function isPluginConfigured(
  pluginConfig?: Record<string, unknown>,
): boolean {
  return !!pluginConfig && Object.keys(pluginConfig).length > 0;
}

/** Read current agent instructions to detect an initialized workspace.
 * @param workspaceDir - Optional workspace; absence indicates first-run setup.
 */
async function hasWorkspaceFiles(
  workspaceDir?: string,
): Promise<boolean> {
  if (!workspaceDir) return false;
  const content = await readWorkspaceAgentInstructions(workspaceDir);

  return WORKSPACE_INSTRUCTION_MARKERS.every(marker => content?.includes(marker));
}

/** Select onboarding guidance without changing configuration or workspace files.
 * @param workspaceDir - Optional workspace to inspect.
 * @param pluginConfig - Current plugin configuration.
 * @param requestedMode - Explicit mode, or automatic detection when omitted.
 */
export async function getOnboardingContext(workspaceDir: string | undefined, pluginConfig: Record<string, unknown> | undefined, requestedMode?: OnboardingMode) {
  const configured = isPluginConfigured(pluginConfig);
  const mode = requestedMode ?? (configured && await hasWorkspaceFiles(workspaceDir) ? ONBOARDING_MODE.RECONFIGURE : ONBOARDING_MODE.FIRST_RUN);

  if (mode === ONBOARDING_MODE.FIRST_RUN) {
    return { mode, configured, instructions: buildOnboardToolContext() };
  }

  if (!workspaceDir) throw new Error("Reconfiguration guidance requires a workspace directory.");
  const models = await readCurrentModels(workspaceDir);

  return { mode, configured, instructions: buildReconfigContext(models) };
}

/** Read effective enabled workspace assignments without changing configuration.
 * @param workspaceDir - Workspace whose resolved role definitions supply model assignments.
 */
async function readCurrentModels(workspaceDir: string): Promise<ModelConfig> {
  const config = await loadConfig(workspaceDir);
  const models: ModelConfig = {};

  for (const [id, role] of Object.entries(config.roles)) {
    if (!role.enabled) continue;
    models[id] = {};
    for (const [level, definition] of Object.entries(role.levels)) {
      models[id][level] = definition.model;
    }
  }

  return models;
}
