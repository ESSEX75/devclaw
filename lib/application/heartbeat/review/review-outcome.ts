/** Pure classification of provider PR status for a human review gate. */

import { REVIEW_CHECK, type ReviewCheckType } from "../../../domain/index.js";
import { PR_STATE, type PrStatus } from "../../../integrations/index.js";
import { REVIEW_OUTCOME } from "./const.js";
import type { ReviewOutcome } from "./types.js";

/** Select the review event from the current PR snapshot.
 * @param status - Provider PR status read during the heartbeat pass.
 * @param check - Workflow's configured review condition.
 * @param acceptsFeedback - Whether the workflow can route review feedback.
 * @param acceptsConflict - Whether the workflow can route a merge conflict.
 */
export function classifyReviewOutcome(status: PrStatus, check: ReviewCheckType, acceptsFeedback = true, acceptsConflict = true): ReviewOutcome {
  if (acceptsFeedback && (status.state === PR_STATE.CHANGES_REQUESTED || status.state === PR_STATE.HAS_COMMENTS)) {
    return { kind: REVIEW_OUTCOME.CHANGES_REQUESTED };
  }

  if (acceptsConflict && status.mergeable === false) return { kind: REVIEW_OUTCOME.CONFLICT };
  if (status.state === PR_STATE.CLOSED) {
    return status.url ? { kind: REVIEW_OUTCOME.CLOSED_UNMERGED } : { kind: REVIEW_OUTCOME.MISSING_PR };
  }

  if (
    (check === REVIEW_CHECK.PR_MERGED && status.state === PR_STATE.MERGED)
    || (check === REVIEW_CHECK.PR_APPROVED && (status.state === PR_STATE.APPROVED || status.state === PR_STATE.MERGED))
  ) return { kind: REVIEW_OUTCOME.APPROVED };

  return { kind: REVIEW_OUTCOME.PENDING };
}
