/**
 * Validates values against identifiers owned by fully resolved runtime configuration.
 */
import type { ResolvedConfig } from "./types.js";

/**
 * Check whether an unknown value identifies a role in the resolved configuration.
 *
 * @param config - Fully resolved configuration containing the authoritative role registry.
 * @param value - Unknown candidate to validate as a configured role identifier.
 */
export function isConfiguredRoleId(
  config: ResolvedConfig,
  value: unknown,
): value is string {
  return typeof value === "string" && Object.hasOwn(config.roles, value);
}
