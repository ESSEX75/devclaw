/** Reads the active OpenClaw agent registry without mixing serialized entries and legacy lists. */

/** Minimal agent inventory shared by SDK snapshots and local read-only consumers. */
export type AgentRegistryConfig<T extends { readonly id: string }> = {
  readonly agents?: {
    readonly entries?: Readonly<Record<string, Omit<T, "id">>>;
    readonly list?: readonly T[];
  };
};

/** Return active agents with their key-derived IDs; entries wins even when empty. */
export function listConfiguredAgents<T extends { readonly id: string }>(config: AgentRegistryConfig<T>): (Omit<T, "id"> & { id: string })[] {
  const agents = config.agents;

  if (agents?.entries !== undefined) {
    return Object.entries(agents.entries).map(([id, entry]) => ({ ...entry, id }));
  }

  return (agents?.list ?? []).map(agent => ({ ...agent, id: agent.id }));
}

/** Find an agent in the active registry only. */
export function findConfiguredAgent<T extends { readonly id: string }>(config: AgentRegistryConfig<T>, id: string): (Omit<T, "id"> & { id: string }) | undefined {
  return listConfiguredAgents(config).find(agent => agent.id === id);
}
