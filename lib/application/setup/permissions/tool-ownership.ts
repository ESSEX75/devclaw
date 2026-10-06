/** Resolves DevClaw tool authorization from validated local project ownership. */

import { listConfiguredAgents } from "../../../integrations/openclaw/agent-registry.js";
import { resolveConfiguredAgentWorkspace } from "../../../integrations/openclaw/agent-workspace.js";
import type { AgentWorkspaceConfig } from "../../../integrations/openclaw/types.js";
import { readOptionalProjects } from "../../../state/index.js";

/** Identify project owners in their configured workspaces.
 * Missing registries are uninitialized; unreadable or invalid registries abort policy mutation.
 * Existing tool allowlists alone never grant ownership.
 * @param config - Fresh SDK configuration containing the configured agents and workspaces.
 */
export async function resolveProjectToolOwners(config: AgentWorkspaceConfig): Promise<ReadonlySet<string>> {
  const agents = listConfiguredAgents(config);

  const authorized = new Set<string>();
  const workspaces = new Map<string, Set<string>>();

  for (const agent of agents) {
    const resolvedWorkspace = await resolveConfiguredAgentWorkspace(config, agent.id);
    const owners = workspaces.get(resolvedWorkspace) ?? new Set<string>();

    owners.add(agent.id);
    workspaces.set(resolvedWorkspace, owners);
  }

  for (const [workspace, candidates] of workspaces) {
    const registry = await readOptionalProjects(workspace);

    for (const project of Object.values(registry?.projects ?? {})) {
      if (candidates.has(project.agentId)) authorized.add(project.agentId);
    }
  }

  return authorized;
}
