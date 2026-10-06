/** Review context limits and acknowledgement protocol identifiers. */

/** Reaction indicating context was supplied to an accepted worker turn, not proof of human reading. */
export const EYES_EMOJI = "eyes";

/** Maximum characters from a PR diff included in worker context. */
export const PR_DIFF_LIMIT = 50_000;

/** Reasons a returning worker receives PR feedback. */
export const PR_FEEDBACK_REASON = {
  CHANGES_REQUESTED: "changes_requested",
  MERGE_CONFLICT: "merge_conflict",
  REJECTED: "rejected",
} as const;

/** Best-effort acknowledgement failure audit event. */
export const COMMENT_MARKING_ERROR = "comment_marking_error";

/** Acknowledgement operation identifiers retained in audit. */
export const COMMENT_MARKING_STEP = {
  ISSUE: "markIssueComment",
  PR: "markPrComment"
} as const;
