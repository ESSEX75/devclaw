/** Owns agents contracts at the OpenClaw adapter boundary. */

/** Read-only SDK workspace inputs; unrelated configuration never crosses this boundary. */
export type AgentWorkspaceConfig = {
  /** Agent inventory and workspace defaults. */
  readonly agents?: AgentWorkspaceInventory;
};

/** Workspace settings understood by SDK agent resolution. */
type AgentWorkspaceInventory = {
  /** Default workspace root when no per-agent override exists. */
  readonly defaults?: AgentWorkspaceDefaults;
  /** Configured agent identifiers and workspace overrides. */
  readonly entries?: Readonly<Record<string, Omit<AgentWorkspaceEntry, "id">>>;
  /** Agent entries supplied in the SDK list representation. */
  readonly list?: readonly AgentWorkspaceEntry[];
};

/** SDK workspace inheritance defaults read without mutation. */
type AgentWorkspaceDefaults = {
  /** Filesystem workspace root supplied by SDK configuration. */
  readonly workspace?: string;
};

/** One configured agent's workspace identity. */
type AgentWorkspaceEntry = {
  /** Stable configured agent identifier. */
  readonly id: string;
  /** Explicit workspace override. */
  readonly workspace?: string;
  /** SDK default-agent marker relevant to workspace inheritance. */
  readonly default?: boolean;
};

/** Agent inventories whose IDs are supplied by keys in the current entries representation. */
type ActiveAgentRegistry<T extends AgentRegistryIdentity> = {
  /** Current SDK serialized entries; key-derived identities take precedence over list. */
  readonly entries?: Readonly<Record<string, Omit<T, "id">>>;
  /** SDK list representation used only when entries is absent. */
  readonly list?: readonly T[];
};

/** Minimal registry snapshot shared by SDK configuration and read-only consumers. */
export type AgentRegistryConfig<T extends AgentRegistryIdentity> = {
  /** Agent inventory in its active SDK representation. */
  readonly agents?: ActiveAgentRegistry<T>;
};

/** Minimum read-only identity required of SDK registry entries. */
export type AgentRegistryIdentity = {
  /** Configured agent identity observed without rewriting the original entry. */
  readonly id: string;
};

/** Fresh mutable identity attached to the cloned active registry entry. */
type ResolvedAgentIdentity = {
  /** Identity derived from the active entry key or SDK list entry. */
  id: string;
};

/** Cloned registry metadata whose identity follows the active SDK representation. */
export type ConfiguredAgent<T extends AgentRegistryIdentity> = Omit<T, "id"> & ResolvedAgentIdentity;
