/** Maps explicit or classified complexity onto the effective role's configured capability ranks. */

import type { TaskComplexity } from "../complexity/index.js";
import { classifyTaskComplexity, TASK_COMPLEXITY } from "../complexity/index.js";
import type { LevelSelection, ResolvedRoleDefinition } from "./types.js";

/** Select a configured level, honoring explicit complexity before textual classification.
 * Simple uses the lowest rank, complex the highest, and medium the configured default.
 * Rejects an empty scale or missing default; never restores built-in levels.
 * @param issueTitle - Task title used only when explicit complexity is absent.
 * @param issueDescription - Task description used only when explicit complexity is absent.
 * @param role - Configured role identifier included in diagnostic messages.
 * @param roleConfig - Complete effective role definition, including custom levels and ranks.
 * @param complexity - Optional explicit complexity that overrides textual heuristics.
 */
export function selectLevel(
  issueTitle: string,
  issueDescription: string,
  role: string,
  roleConfig: ResolvedRoleDefinition,
  complexity?: TaskComplexity,
): LevelSelection {
  const levels = Object.entries(roleConfig.levels).sort(([, left], [, right]) => left.rank - right.rank);
  const lowest = levels[0]?.[0];
  const highest = levels[levels.length - 1]?.[0];

  if (!lowest || !highest) throw new Error(`Role "${role}" has no configured levels.`);
  if (!Object.hasOwn(roleConfig.levels, roleConfig.defaultLevel)) {
    throw new Error(`Role "${role}" has an unknown default level "${roleConfig.defaultLevel}".`);
  }

  if (levels.length === 1) return { level: lowest, reason: `Only level for ${role}` };
  const signal = complexity === undefined
    ? classifyTaskComplexity(issueTitle, issueDescription)
    : { complexity, reason: `Explicit complexity: ${complexity}` };
  const level = signal.complexity === TASK_COMPLEXITY.SIMPLE ? lowest
    : signal.complexity === TASK_COMPLEXITY.COMPLEX ? highest : roleConfig.defaultLevel;

  return { level, reason: signal.reason };
}
