/** Builds the product's built-in configuration layer through role selectors. */
import { DEFAULT_WORKFLOW } from "../../domain/index.js";
import { getAllRoleIds, requireRole } from "../../roles/index.js";
import type { DevClawConfig, LevelOverride, RoleOverride } from "./types.js";

/** Build the complete built-in configuration layer. */
export function buildDefaultConfig(): DevClawConfig {
  const roles: Record<string, RoleOverride> = {};

  for (const id of getAllRoleIds()) {
    const role = requireRole(id);

    roles[id] = { levels: copyBuiltInLevels(role.levels), defaultLevel: role.defaultLevel, completion: { ...role.completion } };
  }

  return { roles, workflow: DEFAULT_WORKFLOW };
}

/** @param levels - Registry-owned built-in level definitions. */
export function copyBuiltInLevels(levels: Readonly<Record<string, LevelOverride | undefined>>): Record<string, LevelOverride> {
  const result: Record<string, LevelOverride> = {};

  for (const [level, definition] of Object.entries(levels)) if (definition) result[level] = { ...definition };

  return result;
}
