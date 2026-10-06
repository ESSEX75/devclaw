/** Exposes built-in role snapshots and pure selection over resolved runtime role configuration. */

export { TASK_COMPLEXITY } from "./const.js";
export { isTaskComplexity } from "./guards.js";
export { selectLevel } from "./level-selection.js";
export { resolveModelForLevel } from "./model-resolution.js";
export {
  getAllBuiltInDefaultModels,
  getAllRoleIds,
  getBuiltInLevelsForRole,
  getBuiltInRole,
  getBuiltInSessionKeyRolePattern,
  getFallbackEmoji,
  requireBuiltInRole,
} from "./queries.js";
export { classifyTaskComplexity } from "./task-complexity.js";
export type {
  BuiltInRoleConfig,
  BuiltInRoleLevelConfig,
  LevelSelection,
  ResolvedRoleDefinition,
  TaskComplexity,
  TaskComplexitySelection,
} from "./types.js";
