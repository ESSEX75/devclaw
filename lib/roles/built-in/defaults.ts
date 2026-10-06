/** Defines the built-in role defaults used by the lowest-precedence configuration layer. */

import { COMPLETION_RESULT, DEFAULT_LEVELS, DEFAULT_ROLES, type RoleId, WORKFLOW_EVENT } from "../../domain/index.js";
import { BUILT_IN_MODELS } from "./const.js";
import type { BuiltInRoleConfig } from "./types.js";

/** Package-private default data; consumers receive isolated snapshots through queries. */
export const BUILT_IN_ROLE_DEFAULTS: Readonly<Record<RoleId, BuiltInRoleConfig>> = {
  [DEFAULT_ROLES.DEVELOPER]: {
    id: DEFAULT_ROLES.DEVELOPER,
    displayName: "DEVELOPER",
    levels: {
      [DEFAULT_LEVELS.JUNIOR]: { rank: 1, model: BUILT_IN_MODELS.FAST, emoji: "⚡" },
      [DEFAULT_LEVELS.MEDIOR]: { rank: 2, model: BUILT_IN_MODELS.BALANCED, emoji: "🔧" },
      [DEFAULT_LEVELS.SENIOR]: { rank: 3, model: BUILT_IN_MODELS.DEEP, emoji: "🧠" },
    },
    defaultLevel: DEFAULT_LEVELS.MEDIOR,
    fallbackEmoji: "🔧",
    completion: {
      [COMPLETION_RESULT.DONE]: WORKFLOW_EVENT.COMPLETE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
  },

  [DEFAULT_ROLES.TESTER]: {
    id: DEFAULT_ROLES.TESTER,
    displayName: "TESTER",
    levels: {
      [DEFAULT_LEVELS.JUNIOR]: { rank: 1, model: BUILT_IN_MODELS.FAST, emoji: "⚡" },
      [DEFAULT_LEVELS.MEDIOR]: { rank: 2, model: BUILT_IN_MODELS.BALANCED, emoji: "🔍" },
      [DEFAULT_LEVELS.SENIOR]: { rank: 3, model: BUILT_IN_MODELS.DEEP, emoji: "🧠" },
    },
    defaultLevel: DEFAULT_LEVELS.MEDIOR,
    fallbackEmoji: "🔍",
    completion: {
      [COMPLETION_RESULT.PASS]: WORKFLOW_EVENT.PASS,
      [COMPLETION_RESULT.FAIL]: WORKFLOW_EVENT.FAIL,
      [COMPLETION_RESULT.REFINE]: WORKFLOW_EVENT.REFINE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
  },

  [DEFAULT_ROLES.ARCHITECT]: {
    id: DEFAULT_ROLES.ARCHITECT,
    displayName: "ARCHITECT",
    levels: {
      [DEFAULT_LEVELS.JUNIOR]: { rank: 1, model: BUILT_IN_MODELS.BALANCED, emoji: "📐" },
      [DEFAULT_LEVELS.SENIOR]: { rank: 2, model: BUILT_IN_MODELS.DEEP, emoji: "🏗️" },
    },
    defaultLevel: DEFAULT_LEVELS.JUNIOR,
    fallbackEmoji: "🏗️",
    completion: {
      [COMPLETION_RESULT.DONE]: WORKFLOW_EVENT.COMPLETE,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
  },

  [DEFAULT_ROLES.REVIEWER]: {
    id: DEFAULT_ROLES.REVIEWER,
    displayName: "REVIEWER",
    levels: {
      [DEFAULT_LEVELS.JUNIOR]: { rank: 1, model: BUILT_IN_MODELS.FAST, emoji: "👁️" },
      [DEFAULT_LEVELS.SENIOR]: { rank: 2, model: BUILT_IN_MODELS.BALANCED, emoji: "🔬" },
    },
    defaultLevel: DEFAULT_LEVELS.JUNIOR,
    fallbackEmoji: "👁️",
    completion: {
      [COMPLETION_RESULT.APPROVE]: WORKFLOW_EVENT.APPROVE,
      [COMPLETION_RESULT.REJECT]: WORKFLOW_EVENT.REJECT,
      [COMPLETION_RESULT.BLOCKED]: WORKFLOW_EVENT.BLOCKED,
    },
  },
};
