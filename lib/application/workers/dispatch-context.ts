/** Loads provider discussion, PR observations, attachments, and role instructions before reservation. */

import { hasReviewCheck, isFeedbackState } from "../../domain/index.js";
import { loadRoleInstructions, type ResolvedConfig } from "../../state/index.js";
import { fetchPrContext, fetchPrFeedback, PR_FEEDBACK_REASON } from "../review/index.js";
import { buildConflictFixMessage, buildTaskMessage,formatAttachmentsForTask, TASK_COMMENT_LIMIT } from "../tasks/index.js";
import type { DispatchContext, DispatchOpts } from "./types.js";

/** Load context without mutating worker ownership or submitting a turn.
 * @param opts - Project issue and provider observations selected for dispatch.
 * @param resolvedConfig - Current role and workflow configuration.
 */
export async function loadDispatchContext(opts: DispatchOpts, resolvedConfig: ResolvedConfig): Promise<DispatchContext> {
  const { workspaceDir, project, issueId, role, fromLabel, provider, issueTitle, issueDescription, issueUrl } = opts;
  const resolvedRole = resolvedConfig.roles[role];
  // Fetch comments to include in task context
  const comments = (await provider.listComments(issueId)).slice(-TASK_COMMENT_LIMIT);

  // Fetch PR context based on workflow role semantics (no hardcoded role/label checks)
  const { workflow } = resolvedConfig;
  const prFeedback = isFeedbackState(workflow, fromLabel)
    ? await fetchPrFeedback(provider, issueId) : undefined;
  const prContext = hasReviewCheck(workflow, role)
    ? await fetchPrContext(provider, issueId) : undefined;

  // Fetch attachment context (best-effort — never blocks dispatch)
  let attachmentContext: string | undefined;

  try {
    attachmentContext = await formatAttachmentsForTask(workspaceDir, project.slug, issueId) || undefined;
  } catch { /* best-effort */ }

  const primaryChannelId = project.channels[0]?.channelId ?? project.slug;
  const isConflictFix = prFeedback?.reason === PR_FEEDBACK_REASON.MERGE_CONFLICT;
  const taskMessage = isConflictFix && prFeedback
    ? buildConflictFixMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      resolvedRole, prFeedback,
    })
    : buildTaskMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueDescription, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      comments, resolvedRole, prContext, prFeedback, attachmentContext,
    });

  // Load role-specific instructions to inject into the worker's system prompt
  const roleInstructions = await loadRoleInstructions(workspaceDir, project.slug, role);

  return { comments, prFeedback, isConflictFix, taskMessage, roleInstructions };
}
