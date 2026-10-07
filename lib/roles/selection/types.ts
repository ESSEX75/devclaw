/** Owns the minimal resolved role contract and configured level selection result. */

import type { RoleLevelDefinition } from "../../domain/index.js";

/** Configured worker level selected for a task. */
export type LevelSelection = {
  /** Selected runtime level identifier. */
  level: string;
  /** Explanation of the selection signal. */
  reason: string;
};

/** Minimal resolved role shape accepted by role-selection behavior. */
export type ResolvedRoleDefinition = {
  /** Runtime levels keyed by configured identifier. */
  readonly levels: Readonly<Record<string, Readonly<RoleLevelDefinition>>>;
  /** Level selected when no complexity signal overrides it. */
  readonly defaultLevel: string;
};
