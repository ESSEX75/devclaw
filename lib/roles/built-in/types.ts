/** Owns readonly built-in role snapshots used by default construction and presentation queries. */

import type { CompletionEventMap, LevelId, RoleId, RoleLevelDefinition } from "../../domain/index.js";

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
