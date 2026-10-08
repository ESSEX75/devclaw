/** Resolves configured agent workspaces and their owned managed projects. */

import type { AgentWorkspaceConfig } from "../../../integrations/index.js";
import { listConfiguredAgents, resolveConfiguredAgentWorkspace } from "../../../integrations/index.js";
import { inspectManagedWorkspace } from "../../../state/index.js";
import { HEARTBEAT_AGENT_ID } from "./const.js";
import type { AgentDiscoveryResult } from "./types.js";

/** Discover unique agent/workspace pairs using SDK workspace resolution and strict project reads.
 * The same workspace may contain different agents' projects; each project is processed only by its configured owner.
 * @param config - Fresh agent inventory from the service configuration.
 */
export async function discoverAgents(config: AgentWorkspaceConfig): Promise<AgentDiscoveryResult> {
  const agents: AgentDiscoveryResult["agents"] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const configured = listConfiguredAgents(config);
  const candidates = [...new Set([...configured.map(agent => agent.id),
    ...(configured.length === 0 || config.agents?.defaults?.workspace ? [HEARTBEAT_AGENT_ID.MAIN] : [])])];

  for (const agentId of candidates) {
    try {
      const resolved = await resolveConfiguredAgentWorkspace(config, agentId);
      const { workspace, projects } = await inspectManagedWorkspace(resolved);

      if (!projects || !Object.values(projects.projects).some(project => project.agentId === agentId)) continue;
      const key = JSON.stringify([agentId, workspace]);

      if (seen.has(key)) continue;
      seen.add(key);
      agents.push({ agentId, workspace });
    } catch (error) {
      errors.push(`Agent ${agentId} workspace discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { agents, errors };
}
