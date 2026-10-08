/** Marks only delivered comment context as noticed using its provider-owned reaction namespace. */

import { log as auditLog } from "../../audit.js";
import { type IssueComment, PR_COMMENT_KIND } from "../../integrations/providers/contracts/index.js";
import { COMMENT_MARKING_ERROR, COMMENT_MARKING_STEP, EYES_EMOJI } from "./const.js";
import type { AcknowledgementProvider, PrFeedback } from "./types.js";

/** Mark comments supplied to an accepted worker turn; reactions are best-effort and idempotent on read-back.
 * Review summaries are skipped because they are not comment reaction targets. A failed reaction
 * does not prevent remaining comments from being processed, and does not fail dispatch.
 * @param provider - Narrow reaction capability.
 * @param issueId - Issue whose comments were included in the accepted turn.
 * @param comments - Issue comments actually included in that turn.
 * @param prFeedback - PR feedback actually included in that turn.
 * @param workspaceDir - Optional audit workspace for reaction failures.
 */
export async function acknowledgeComments(
  provider: AcknowledgementProvider, issueId: number, comments: IssueComment[], prFeedback?: PrFeedback, workspaceDir?: string,
): Promise<void> {
  for (const comment of comments) {
    try {
      if (!await provider.issueCommentHasReaction(issueId, comment.id, EYES_EMOJI)) {
        await provider.reactToIssueComment(issueId, comment.id, EYES_EMOJI);
      }
    } catch (error) {
      await recordFailure(workspaceDir, issueId, comment.id, COMMENT_MARKING_STEP.ISSUE, error);
    }
  }

  for (const comment of prFeedback?.comments ?? []) {
    try {
      if (comment.kind === PR_COMMENT_KIND.REVIEW) continue;
      if (comment.kind === PR_COMMENT_KIND.INLINE) {
        if (!await provider.prReviewCommentHasReaction(issueId, comment.id, EYES_EMOJI)) {
          await provider.reactToPrReviewComment(issueId, comment.id, EYES_EMOJI);
        }
      } else if (comment.kind === PR_COMMENT_KIND.CONVERSATION) {
        if (!await provider.prCommentHasReaction(issueId, comment.id, EYES_EMOJI)) {
          await provider.reactToPrComment(issueId, comment.id, EYES_EMOJI);
        }
      }
    } catch (error) {
      await recordFailure(workspaceDir, issueId, comment.id, COMMENT_MARKING_STEP.PR, error);
    }
  }
}

/** Record a reaction failure without allowing unavailable audit storage to abort acknowledgement.
 * @param workspaceDir - Optional workspace containing audit storage.
 * @param issueId - Owning issue identifier.
 * @param commentId - Provider-local comment identifier.
 * @param step - Reaction operation that failed.
 * @param error - Unknown failure from the provider.
 */
async function recordFailure(workspaceDir: string | undefined, issueId: number, commentId: number, step: string, error: unknown): Promise<void> {
  if (!workspaceDir) return;
  await auditLog(workspaceDir, COMMENT_MARKING_ERROR, {
    step, issue: issueId, commentId, error: error instanceof Error ? error.message : String(error),
  }).catch(() => {});
}
