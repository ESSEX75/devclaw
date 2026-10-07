/** Reads the active SDK agent registry without mixing entries and list representations. */

import type { AgentRegistryConfig, AgentRegistryIdentity, ConfiguredAgent } from "./types.js";

/** Return active agents with key-derived IDs; an explicitly empty entries map still wins.
 * @param config - Current SDK registry snapshot whose active representation must be respected.
 */
export function listConfiguredAgents<T extends AgentRegistryIdentity>(config: AgentRegistryConfig<T>): ConfiguredAgent<T>[] {
  const agents = config.agents;

  if (agents?.entries !== undefined) {
    return Object.entries(agents.entries).map(([id, entry]) => ({ ...entry, id }));
  }

  return (agents?.list ?? []).map(agent => ({ ...agent, id: agent.id }));
}

/** Resolve an exact agent only from the active registry representation.
 * @param config - Current SDK agent registry snapshot.
 * @param id - Configured agent identity to inspect.
 */
export function findConfiguredAgent<T extends AgentRegistryIdentity>(config: AgentRegistryConfig<T>, id: string): ConfiguredAgent<T> | undefined {
  return listConfiguredAgents(config).find(agent => agent.id === id);
}
