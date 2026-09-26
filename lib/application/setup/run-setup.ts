/** Applies validated setup plans shared by CLI and tools. */
import { initializeWorkspaceFiles, refreshSystemInstructionFiles, resetDefaults, scaffoldWorkspace, writeWorkspaceModels } from "../../state/index.js";
import { createAgent } from "./agent-config.js";
import { ensureChannelBinding } from "./binding-manager.js";
import { writePluginConfig } from "./plugin-config.js";
import { ensureRequiredOpenClawScopes } from "./scopes.js";
import { planSetup } from "./setup-plan.js";
import type { SetupOpts, SetupResult } from "./types.js";

/** Validate before effects and preserve existing files unless replacement was explicitly requested.
 * @param opts - Target, overrides, operation, preview selection, and runtime capabilities.
 */
export async function runSetup(opts: SetupOpts): Promise<SetupResult> {
  const result = await planSetup(opts);

  if (opts.dryRun) return result;
  const { agentId, workspacePath, agentCreated } = result;

  if (result.operation !== "configure") {
    const written = opts.resetDefaults ? await resetDefaults(workspacePath)
      : opts.refreshInstructions ? await refreshSystemInstructionFiles(workspacePath)
      : await initializeWorkspaceFiles(workspacePath);

    return { ...result, filesWritten: written.written };
  }

  result.scopePreflight = await ensureRequiredOpenClawScopes(opts.runCommand);
  if (opts.newAgentName) await createAgent(opts.runtime, opts.newAgentName);
  if (opts.channelBinding && opts.channelAccountId && opts.channelPeerId) {
    await ensureChannelBinding(opts.runtime, opts.channelBinding, agentId, opts.channelAccountId, opts.channelPeerId);
  }

  await writePluginConfig(opts.runtime, opts.agentId || agentCreated ? agentId : undefined, opts.projectExecution);
  result.filesWritten = (await scaffoldWorkspace(workspacePath, opts.runtime.config.current().agents?.defaults?.workspace)).written;
  if (opts.models) {
    result.filesWritten.push(...(await writeWorkspaceModels(workspacePath, opts.models)).written);
  }

  return { ...result, filesWritten: [...new Set(result.filesWritten)] };
}
