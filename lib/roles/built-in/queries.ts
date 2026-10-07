/** Provides isolated snapshots and presentation queries over built-in role defaults. */

import { isBuiltInLevelId, isBuiltInRoleId, type LevelId, type RoleId } from "../../domain/index.js";
import { DEFAULT_ROLE_EMOJI } from "./const.js";
import { BUILT_IN_ROLE_DEFAULTS } from "./defaults.js";
import type { BuiltInRoleConfig } from "./types.js";

/** List built-in role identifiers in declaration order; runtime roles come from resolved configuration. */
export function getAllRoleIds(): RoleId[] {
  return Object.values(BUILT_IN_ROLE_DEFAULTS).map(role => role.id);
}

/** Read an independent readonly built-in snapshot, or undefined for a configured custom role.
 * @param role - Candidate built-in identifier, never validated against runtime configuration here.
 */
export function getBuiltInRole(role: string): BuiltInRoleConfig | undefined {
  return isBuiltInRoleId(role) ? structuredClone(BUILT_IN_ROLE_DEFAULTS[role]) : undefined;
}

/** Require a built-in snapshot for constructing defaults; rejects custom or unknown identifiers.
 * @param role - Built-in role whose defaults are required by the caller.
 */
export function requireBuiltInRole(role: string): BuiltInRoleConfig {
  const config = getBuiltInRole(role);

  if (!config) throw new Error(`Unknown built-in role: "${role}". Valid roles: ${getAllRoleIds().join(", ")}`);

  return config;
}

/** List levels declared by a built-in role; this is not a runtime membership check.
 * @param role - Built-in role whose supported default levels are queried.
 */
export function getBuiltInLevelsForRole(role: string): readonly LevelId[] {
  const levels = getBuiltInRole(role)?.levels;

  return levels ? Object.keys(levels).filter(isBuiltInLevelId) : [];
}

/** Build independent role-level model assignments for initial setup guidance. */
export function getAllBuiltInDefaultModels(): Record<string, Record<string, string>> {
  const models: Record<string, Record<string, string>> = {};

  for (const id of getAllRoleIds()) {
    const role = requireBuiltInRole(id);

    models[id] = {};
    for (const level of getBuiltInLevelsForRole(id)) {
      const definition = role.levels[level];

      if (definition) models[id][level] = definition.model;
    }
  }

  return models;
}

/** Get the built-in announcement fallback, or the generic marker for custom roles.
 * @param role - Built-in or configured custom role used in announcement presentation.
 */
export function getFallbackEmoji(role: string): string {
  return getBuiltInRole(role)?.fallbackEmoji ?? DEFAULT_ROLE_EMOJI;
}

/** Build the built-in role alternatives used by the worker session-key parser. */
export function getBuiltInSessionKeyRolePattern(): string {
  return getAllRoleIds().join("|");
}
