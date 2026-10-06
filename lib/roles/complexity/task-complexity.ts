/** Classifies task text into complexity signals independently of roles, levels, or models. */

import { COMPLEX_TASK_KEYWORDS, COMPLEX_TASK_WORD_LIMIT, SIMPLE_TASK_KEYWORDS, SIMPLE_TASK_WORD_LIMIT, TASK_COMPLEXITY } from "./const.js";
import type { TaskComplexitySelection } from "./types.js";

/** Classify task text with complex signals taking precedence over simple signals.
 * Word boundaries avoid accidental substring matches; long descriptions are complex.
 * @param issueTitle - Task title contributing complexity signals.
 * @param issueDescription - Task description contributing signals and word count.
 */
export function classifyTaskComplexity(issueTitle: string, issueDescription: string): TaskComplexitySelection {
  const text = `${issueTitle}\n${issueDescription}`.toLowerCase().trim();
  const wordCount = text ? text.split(/\s+/u).length : 0;
  const complexMatches = COMPLEX_TASK_KEYWORDS.filter(keyword => matchesKeyword(text, keyword));

  if (complexMatches.length > 0 || wordCount > COMPLEX_TASK_WORD_LIMIT) {
    return {
      complexity: TASK_COMPLEXITY.COMPLEX,
      reason: complexMatches.length > 0 ? `Complex keywords: ${complexMatches.join(", ")}` : "Long description",
    };
  }

  const simpleMatches = SIMPLE_TASK_KEYWORDS.filter(keyword => matchesKeyword(text, keyword));

  if (simpleMatches.length > 0 && wordCount < SIMPLE_TASK_WORD_LIMIT) {
    return { complexity: TASK_COMPLEXITY.SIMPLE, reason: `Simple keywords: ${simpleMatches.join(", ")}` };
  }

  return { complexity: TASK_COMPLEXITY.MEDIUM, reason: "No strong complexity signal" };
}

/** Match a policy keyword or phrase without matching inside another word.
 * @param text - Lowercase task text inspected for a complexity signal.
 * @param keyword - Policy-owned word or phrase, with literal characters escaped.
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const pattern = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");

  return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, "u").test(text);
}
