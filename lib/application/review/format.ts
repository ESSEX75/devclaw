/** Renders provider observations into worker context without I/O. */

import { PR_DIFF_LIMIT, PR_FEEDBACK_REASON } from "./const.js";
import type { PrContext, PrFeedback } from "./types.js";

/**
 * Format PR context section for task message.
 * @param prContext - Observed PR identity and optional diff.
 */
export function formatPrContext(prContext: PrContext): string[] {
  const parts: string[] = [``, `## Pull Request`, `🔗 ${prContext.url}`];

  //TODO: You need to compress based on context, not just crop.
  if (prContext.diff) {
    const diff = prContext.diff.length > PR_DIFF_LIMIT
      ? prContext.diff.slice(0, PR_DIFF_LIMIT) + "\n... (diff truncated, see PR for full changes)"
      : prContext.diff;

    parts.push(``, `### Diff`, "```diff", diff, "```");
  }

  return parts;
}

/**
 * Format PR review feedback section for task message.
 * @param prFeedback - Conflict or review observations, including their provider identity.
 * @param baseBranch - Configured target branch for conflict resolution.
 */
export function formatPrFeedback(prFeedback: PrFeedback, baseBranch: string): string[] {
  if (prFeedback.comments.length === 0 && prFeedback.reason !== PR_FEEDBACK_REASON.MERGE_CONFLICT) return [];

  const reasonLabel = prFeedback.reason === PR_FEEDBACK_REASON.MERGE_CONFLICT
    ? "⚠️ Merge conflicts detected"
    : prFeedback.reason === PR_FEEDBACK_REASON.CHANGES_REQUESTED
      ? "⚠️ Changes were requested"
      : "⚠️ PR was rejected";

  const parts: string[] = [
    ``, `## PR Review Feedback`,
    `${reasonLabel}. Address the feedback below.`,
    `🔗 ${prFeedback.url}`,
  ];

  for (const c of prFeedback.comments) {
    const location = c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";

    parts.push(``, `**${c.author}** [${c.state}]${location}:`, c.body);
  }

  if (prFeedback.reason === PR_FEEDBACK_REASON.MERGE_CONFLICT) {
    const branchName = prFeedback.branchName;

    if (!branchName) {
      parts.push("", "### Conflict Resolution Instructions",
        "Find the source branch using the PR URL above before making changes.",
        `Update that existing branch against ${baseBranch}, resolve conflicts, and push to the same PR.`);

      return parts;
    }

    parts.push(
      ``, `### Conflict Resolution Instructions`,
      ``,
      `**Important:** You must update the EXISTING PR branch, not create a new one.`,
      ``,
      `🔹 PR: ${prFeedback.url}`,
      `🔹 Branch: \`${branchName}\``,
      ``,
      `**Step-by-step:**`,
      ``,
      `1. Fetch and check out the PR branch:`,
      `   \`\`\`bash`,
      `   git fetch origin ${branchName}`,
      `   git checkout ${branchName}`,
      `   \`\`\``,
      ``,
      `2. Rebase onto \`${baseBranch}\`:`,
      `   \`\`\`bash`,
      `   git rebase ${baseBranch}`,
      `   \`\`\``,
      ``,
      `3. Resolve any conflicts:`,
      `   - Edit conflicted files (marked with <<<<<<< and >>>>>>>)`,
      `   - \`git add <resolved-files>\``,
      `   - \`git rebase --continue\``,
      `   - Repeat until rebase completes`,
      ``,
      `4. Force-push to the SAME branch:`,
      `   \`\`\`bash`,
      `   git push --force-with-lease origin ${branchName}`,
      `   \`\`\``,
      ``,
      `5. Verify the PR shows as mergeable:`,
      `   \`\`\`bash`,
      `   gh pr view <PR-number>`,
      `   # Status should be "Mergeable" or "Open"`,
      `   \`\`\``,
      ``,
      `⚠️ Do NOT create a new PR. Do NOT switch branches. Update THIS PR only.`,
    );
  }

  return parts;
}
