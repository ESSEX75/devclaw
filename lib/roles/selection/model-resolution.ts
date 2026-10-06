/** Resolves explicit model assignments from authoritative, fully resolved role configuration. */

import type { ResolvedRoleDefinition } from "./types.js";

/** Resolve a configured level's model without registry fallback or raw-ID passthrough.
 * Throws when the level is absent or its model is empty, including stale persisted levels.
 * @param level - Level identifier selected from the effective role configuration.
 * @param resolvedRole - Complete role definition after configuration merge and validation.
 */
export function resolveModelForLevel(level: string, resolvedRole: ResolvedRoleDefinition): string {
  if (!Object.hasOwn(resolvedRole.levels, level)) {
    throw new Error(`Unknown configured level "${level}". Valid levels: ${Object.keys(resolvedRole.levels).join(", ")}`);
  }

  const model = resolvedRole.levels[level].model;

  if (!model.trim()) throw new Error(`Configured level "${level}" has no model assignment.`);

  return model;
}
