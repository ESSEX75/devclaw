/**
 * roles/ — Centralized role configuration.
 *
 * Single source of truth for all worker roles in DevClaw.
 * To add a new role, add an entry to registry.ts — everything else derives from it.
 */

export { TASK_COMPLEXITY } from "./const.js";
export { isTaskComplexity } from "./guards.js";
export { selectLevel } from "./level-selection.js";
export { resolveModelForLevel } from "./model-resolution.js";
export { ROLE_REGISTRY } from "./registry.js";
export {
  // Role/level aliases (used by migration + tests)
  canonicalLevel,
  getAllDefaultModels,
  getAllLevels,
  // Role IDs
  getAllRoleIds,
  // Completion
  getCompletionEvent,
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
  roleForLevel,
} from "./selectors.js";
export { classifyTaskComplexity } from "./task-complexity.js";
export type { LevelSelection, ResolvedRoleDefinition, RoleConfig, RoleLevelConfig, TaskComplexity, TaskComplexitySelection } from "./types.js";
