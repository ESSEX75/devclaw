/** Owns built-in role snapshots and minimal resolved contracts for pure runtime selection. */

import type { CompletionEventMap, LevelId, RoleId, RoleLevelDefinition } from "../domain/index.js";
import type { ValueOf } from "../types.js";
import type { TASK_COMPLEXITY } from "./const.js";

/** Supported explicit task-complexity signals, derived from their canonical identifiers. */
export type TaskComplexity = ValueOf<typeof TASK_COMPLEXITY>;

/** Complexity decision consumed by rank-based level selection. */
export type TaskComplexitySelection = {
  /** Explicit or inferred complexity category. */
  complexity: TaskComplexity;
  /** Explanation of the evidence supporting the category. */
  reason: string;
};

/** Configured worker level selected for a task. */
export type LevelSelection = {
  /** Selected runtime level identifier. */
  level: string;
  /** Explanation of the selection signal. */
  reason: string;
};

/** Complete built-in definition of one worker capability level. */
export type BuiltInRoleLevelConfig = Readonly<RoleLevelDefinition & {
  /** Announcement emoji. */
  emoji: string;
}>;

/** Independent readonly snapshot of one built-in role; runtime overrides live in resolved configuration. */
export type BuiltInRoleConfig = {
  /** Unique role identifier (e.g., "developer", "tester", "architect"). */
  readonly id: RoleId;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Complete level definitions keyed by built-in level identifier. */
  readonly levels: Readonly<Partial<Record<LevelId, BuiltInRoleLevelConfig>>>;
  /** Default level when none specified. */
  readonly defaultLevel: LevelId;
  /** Fallback emoji when level-specific emoji not found. */
  readonly fallbackEmoji: string;
  /** Explicit mapping from valid completion results to workflow events. */
  readonly completion: Readonly<CompletionEventMap>;
};

/** Minimal resolved role shape accepted by role-selection behavior. */
export type ResolvedRoleDefinition = {
  /** Runtime levels keyed by configured identifier. */
  readonly levels: Readonly<Record<string, Readonly<RoleLevelDefinition>>>;
  /** Level selected when no complexity signal overrides it. */
  readonly defaultLevel: string;
};
