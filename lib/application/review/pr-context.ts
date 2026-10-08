/** Fetches optional PR observations while preserving known identity on secondary read failures. */

import { PR_STATE } from "../../integrations/index.js";
import { PR_FEEDBACK_REASON } from "./const.js";
import type { ContextProvider, FeedbackProvider, PrContext, PrFeedback } from "./types.js";

/** Fetch actionable feedback from an active PR; conflicts remain actionable without comments.
 * Unavailable status yields no context; unavailable comments do not discard a known conflict.
 * @param provider - Provider status and review-reading capabilities.
 * @param issueId - Issue whose active PR should be selected.
 */
export async function fetchPrFeedback(provider: FeedbackProvider, issueId: number): Promise<PrFeedback | undefined> {
  try {
    const status = await provider.getPrStatus(issueId);

    if (!status.url || status.state === PR_STATE.MERGED || status.state === PR_STATE.CLOSED) return undefined;
    // A delivery receipt suppresses duplicate workflow events, not context needed by a retried worker.
    const comments = await provider.getPrReviewComments(issueId, status.url).catch(() => []);
    const conflict = status.mergeable === false;

    if (!conflict && comments.length === 0) return undefined;
    const reason = conflict ? PR_FEEDBACK_REASON.MERGE_CONFLICT
      : status.state === PR_STATE.CHANGES_REQUESTED || status.state === PR_STATE.HAS_COMMENTS
        ? PR_FEEDBACK_REASON.CHANGES_REQUESTED : PR_FEEDBACK_REASON.REJECTED;

    return {
      url: status.url,
      branchName: status.sourceBranch,
      reason,
      comments: comments.map(({ id, author, body, state, path, line, kind }) => ({ id, author, body, state, path, line, kind })),
    };
  } catch {
    return undefined;
  }
}

/** Fetch reviewer context for an active PR, retaining its URL if the diff cannot be read.
 * @param provider - Provider PR status and diff-reading capabilities.
 * @param issueId - Issue whose active PR should be reviewed.
 */
export async function fetchPrContext(provider: ContextProvider, issueId: number): Promise<PrContext | undefined> {
  try {
    const status = await provider.getPrStatus(issueId);

    if (!status.url || status.state === PR_STATE.MERGED || status.state === PR_STATE.CLOSED) return undefined;
    const diff = await provider.getPrDiff(issueId, status.url).catch(() => null);

    return { url: status.url, diff: diff ?? undefined };
  } catch {
    return undefined;
  }
}
