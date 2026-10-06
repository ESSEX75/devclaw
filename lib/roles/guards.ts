/** Validates explicit complexity input without restricting configured role or level identifiers. */

import { TASK_COMPLEXITY } from "./const.js";
import type { TaskComplexity } from "./types.js";

/** Narrow an untrusted value to a supported explicit complexity signal.
 * @param value - Optional complexity value supplied by a tool boundary.
 */
export function isTaskComplexity(value: unknown): value is TaskComplexity {
  return value === TASK_COMPLEXITY.SIMPLE
    || value === TASK_COMPLEXITY.MEDIUM
    || value === TASK_COMPLEXITY.COMPLEX;
}
