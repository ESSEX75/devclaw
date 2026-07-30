/**
 * Queries over fully resolved role configuration.
 */
import type { ResolvedConfig, ResolvedRoleConfig } from "./types.js";

/** Return configured role identifiers, optionally including disabled roles. */
export function getConfiguredRoleIds(
  config: ResolvedConfig,
  includeDisabled = false,
): string[] {
  return Object.entries(config.roles)
    .filter(([, role]) => includeDisabled || role.enabled)
    .map(([roleId]) => roleId);
}

/** Resolve a role definition from the authoritative runtime configuration. */
export function getResolvedRole(
  config: ResolvedConfig,
  roleId: string,
): ResolvedRoleConfig | undefined {
  return config.roles[roleId];
}

/** Check whether a role exists in resolved configuration. */
export function isConfiguredRoleId(
  config: ResolvedConfig,
  value: unknown,
): value is string {
  return typeof value === "string" && value in config.roles;
}
