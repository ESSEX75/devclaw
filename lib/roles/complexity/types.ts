/** Owns the complexity categories and decisions independent of role configuration. */

import type { ValueOf } from "../../types.js";
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
