/** Exposes isolated built-in snapshots and presentation queries without exposing default data. */

export {
  getAllBuiltInDefaultModels,
  getAllRoleIds,
  getBuiltInLevelsForRole,
  getBuiltInRole,
  getBuiltInSessionKeyRolePattern,
  getFallbackEmoji,
  requireBuiltInRole,
} from "./queries.js";
export type { BuiltInRoleConfig, BuiltInRoleLevelConfig } from "./types.js";
