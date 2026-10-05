/** Resolves effective agent workspaces through the installed OpenClaw SDK contract. */

import type { AgentWorkspaceConfig } from "./types.js";

/** Resolve explicit and implicit workspaces without duplicating SDK fallback rules.
 * @param config - Fresh SDK configuration snapshot.
 * @param agentId - Configured agent whose project ownership will be inspected.
 */
export async function resolveConfiguredAgentWorkspace(config: AgentWorkspaceConfig, agentId: string): Promise<string> {
  const { resolveAgentWorkspaceDir } = await import("openclaw/plugin-sdk/agent-runtime");

  // Copy only resolver inputs so readonly SDK snapshots need no unsafe cast.
  return resolveAgentWorkspaceDir({ agents: config.agents ? {
    defaults: config.agents.defaults ? { workspace: config.agents.defaults.workspace } : undefined,
    entries: config.agents.entries === undefined ? undefined : Object.fromEntries(
      Object.entries(config.agents.entries).map(([id, agent]) => [id, { workspace: agent.workspace, default: agent.default }]),
    ),
    list: config.agents.list?.map(agent => ({ id: agent.id, workspace: agent.workspace, default: agent.default })),
  } : undefined }, agentId);
}
