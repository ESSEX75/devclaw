/**
 * Selects a configured worker level from task complexity and explicit level ranks.
 * The selector treats built-in and custom roles identically through resolved role configuration.
 */
import type { ResolvedRoleConfig } from "../state/config/index.js";

export type LevelSelection = {
  /** Selected configured level identifier. */
  level: string;
  /** Human-readable explanation of the selection signal. */
  reason: string;
};

// Keywords that indicate simple tasks
const SIMPLE_KEYWORDS = [
  "simple",
  "typo",
  "fix typo",
  "rename",
  "update text",
  "change color",
  "minor",
  "small",
  "css",
  "style",
  "copy",
  "wording",
];

// Keywords that indicate complex tasks
const COMPLEX_KEYWORDS = [
  "architect",
  "refactor",
  "redesign",
  "system-wide",
  "migration",
  "database schema",
  "security",
  "performance",
  "infrastructure",
  "multi-service",
];

/**
 * Select the level appropriate for a task from a fully resolved role definition.
 * Simple tasks use the lowest rank, complex tasks use the highest rank, and
 * tasks without a strong signal use the role's configured default level.
 *
 * @param issueTitle - Provider title used for the complexity heuristic.
 * @param issueDescription - Provider description used for the complexity heuristic.
 * @param role - Configured role identifier used in the selection explanation.
 * @param roleConfig - Resolved role whose levels and ranks define the available scale.
 */
export function selectLevel(
  issueTitle: string,
  issueDescription: string,
  role: string,
  roleConfig: ResolvedRoleConfig,
): LevelSelection {
  const levels = Object.entries(roleConfig.levels).sort(
    ([, left], [, right]) => left.rank - right.rank,
  );
  const lowest = levels[0]?.[0];
  const highest = levels[levels.length - 1]?.[0];

  if (!lowest || !highest) {
    throw new Error(`Role "${role}" has no configured levels.`);
  }

  if (levels.length === 1) {
    return { level: lowest, reason: `Only level for ${role}` };
  }

  const text = `${issueTitle} ${issueDescription}`.toLowerCase();
  const wordCount = text.split(/\s+/).length;
  const simpleMatches = SIMPLE_KEYWORDS.filter((keyword) => text.includes(keyword));
  const complexMatches = COMPLEX_KEYWORDS.filter((keyword) => text.includes(keyword));

  if (simpleMatches.length > 0 && wordCount < 100) {
    return {
      level: lowest,
      reason: `Simple task detected (keywords: ${simpleMatches.join(", ")})`,
    };
  }

  if (complexMatches.length > 0 || wordCount > 500) {
    return {
      level: highest,
      reason: `Complex task detected (${complexMatches.length > 0 ? `keywords: ${complexMatches.join(", ")}` : "long description"})`,
    };
  }

  return { level: roleConfig.defaultLevel, reason: `Standard ${role} task` };
}
