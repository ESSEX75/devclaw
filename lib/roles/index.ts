/** Exposes supported roles capabilities to external consumers through one stable package API. */

export type { BuiltInRoleConfig, BuiltInRoleLevelConfig } from "./built-in/index.js";
export {
  getAllBuiltInDefaultModels,
  getAllRoleIds,
  getBuiltInLevelsForRole,
  getBuiltInRole,
  getBuiltInSessionKeyRolePattern,
  getFallbackEmoji,
  requireBuiltInRole,
} from "./built-in/index.js";
export type { TaskComplexity, TaskComplexitySelection } from "./complexity/index.js";
export { classifyTaskComplexity, isTaskComplexity, TASK_COMPLEXITY } from "./complexity/index.js";
export type { LevelSelection, ResolvedRoleDefinition } from "./selection/index.js";
export { resolveModelForLevel, selectLevel } from "./selection/index.js";
