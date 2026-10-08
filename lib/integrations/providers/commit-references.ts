/** Finds exact issue references in local git history without interpreting unrelated MR numbers as issues. */

import type { RunCommand } from "../../context.js";
import { PROVIDER_HISTORY_FORMAT, PROVIDER_HISTORY_REMOTE } from "./const.js";
import { runProviderCommand } from "./transport/index.js";

/** Search complete messages on the selected base branch for an exact numeric issue reference.
 * Git history is not capped at 200 commits; process failure remains a failed observation.
 * @param runCommand - Runtime-owned git command transport.
 * @param repoPath - Checkout containing the selected remote tracking branch.
 * @param issueId - Positive provider issue number to match exactly.
 * @param baseBranch - Validated branch chosen by project configuration.
 */
export async function hasIssueCommitOnBaseBranch(runCommand: RunCommand, repoPath: string, issueId: number, baseBranch: string): Promise<boolean> {
  if (!Number.isSafeInteger(issueId) || issueId <= 0) throw new Error("Issue history lookup requires a positive safe issue ID.");
  const pattern = `(^|[^[:alnum:]_#])#${issueId}([^[:alnum:]_]|$)`;
  const output = await runProviderCommand(runCommand,
    ["git", "log", `${PROVIDER_HISTORY_REMOTE}/${baseBranch}`, `--format=${PROVIDER_HISTORY_FORMAT}`, "--extended-regexp", "--grep", pattern, "--"], repoPath);

  return output.length > 0;
}
