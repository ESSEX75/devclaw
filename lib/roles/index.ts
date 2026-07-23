/**
 * roles/ — Centralized role configuration.
 *
 * Single source of truth for all worker roles in DevClaw.
 * To add a new role, add an entry to registry.ts — everything else derives from it.
 */
export { ROLE_REGISTRY } from "./registry.js";
export {
  // Role/level aliases (used by migration + tests)
  canonicalLevel,
  getAllDefaultModels,
  getAllLevels,
  // Role IDs
  getAllRoleIds,
  // Completion
  getCompletionResults,
  getDefaultLevel,
  // Models
  getDefaultModel,
  // Emoji
  getEmoji,
  getFallbackEmoji,
  // Levels
  getLevelsForRole,
  getRole,
  // Session keys
  getSessionKeyRolePattern,
  isLevelForRole,
  isValidResult,
  isValidRole,
  requireRole,
  resolveModel,
  roleForLevel,
} from "./selectors.js";
export type { RoleConfig } from "./types.js";
