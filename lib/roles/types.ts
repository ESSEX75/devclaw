/**
 * roles/types.ts — Type definitions for the role registry.
 *
 * RoleConfig is the single interface describing everything about a role.
 * All role-related behavior should be derived from this config.
 */

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
export type RoleLevelConfig = RoleLevelDefinition & {
  /** Announcement emoji. */
  emoji: string;
};

/** Configuration for a single worker role. */
export type RoleConfig = {
  /** Unique role identifier (e.g., "developer", "tester", "architect"). */
  id: RoleId;
  /** Human-readable display name. */
  displayName: string;
  /** Complete level definitions keyed by built-in level identifier. */
  levels: Readonly<Partial<Record<LevelId, RoleLevelConfig>>>;
  /** Default level when none specified. */
  defaultLevel: LevelId;
  /** Fallback emoji when level-specific emoji not found. */
  fallbackEmoji: string;
  /** Explicit mapping from valid completion results to workflow events. */
  completion: CompletionEventMap;
  /** Regex pattern fragment for session key matching (e.g., "developer|tester|architect"). */
  sessionKeyPattern: string;
  /** Notification config per event type. */
  notifications: {
    onStart: boolean;
    onComplete: boolean;
  };
};

/** Minimal resolved role shape accepted by role-selection behavior. */
export type ResolvedRoleDefinition = {
  /** Runtime levels keyed by configured identifier. */
  levels: Record<string, RoleLevelDefinition>;
  /** Level selected when no complexity signal overrides it. */
  defaultLevel: string;
};
