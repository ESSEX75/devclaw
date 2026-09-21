/**
 * Queries over fully resolved role configuration.
 */
import type { ResolvedConfig, ResolvedRoleConfig } from "./types.js";

/**
 * Project a resolved role's structured levels into worker-slot capacities.
 *
 * @param role - Resolved role whose level concurrency should initialize or reconcile slots.
 */
export function getLevelMaxWorkers(role: ResolvedRoleConfig | undefined): Record<string, number> {
  const capacities: Record<string, number> = {};

  for (const [level, definition] of Object.entries(role?.levels ?? {})) {
    capacities[level] = definition.maxWorkers;
  }

  return capacities;
}

/**
 * Return configured role identifiers, excluding disabled roles unless explicitly requested.
 *
 * @param config - Fully resolved configuration containing the authoritative role registry.
 * @param includeDisabled - Whether explicitly disabled roles should remain in the result.
 */
export function getConfiguredRoleIds(
  config: ResolvedConfig,
  includeDisabled = false,
): string[] {
  return Object.entries(config.roles)
    .filter(([, role]) => includeDisabled || role.enabled)
    .map(([roleId]) => roleId);
}

/**
 * Resolve one role definition from the authoritative runtime configuration.
 *
 * @param config - Fully resolved configuration containing the authoritative role registry.
 * @param roleId - Configured role identifier to look up.
 */
export function getResolvedRole(
  config: ResolvedConfig,
  roleId: string,
): ResolvedRoleConfig | undefined {
  return config.roles[roleId];
}
