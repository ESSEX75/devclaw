/** Selects onboarding scenarios from read-only workspace and plugin configuration evidence. */

import { readWorkspaceAgentInstructions } from "../../state/index.js";
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

  return { mode, configured, instructions: mode === ONBOARDING_MODE.FIRST_RUN ? buildOnboardToolContext() : buildReconfigContext() };
}
