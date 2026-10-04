/** Identifiers and command defaults owned by heartbeat review transitions. */

/** Audit event names emitted while heartbeat processes review transitions. */
export const REVIEW_AUDIT_EVENT = {
  GIT_FALLBACK: "review_git_fallback",
  TRANSITION: "review_transition",
  MERGE_FAILED: "review_merge_failed",
  SKIP_MERGE_FAILED: "review_skip_merge_failed",
  SKIP_TRANSITION: "review_skip_transition",
} as const;

/** Stable operation owners recorded by review transitions and projection work. */
export const REVIEW_TRANSITION_OWNER = {
  REVIEW: "heartbeat_review",
  REVIEW_SKIP: "heartbeat_review_skip",
  REVIEW_SKIP_MERGE_FAILURE: "heartbeat_review_skip_merge_failure",
} as const;

/** Reasons stored in review audit records and supplied to feedback callbacks. */
export const REVIEW_TRANSITION_REASON = {
  COMMIT_ON_BASE_BRANCH: "commit_on_base_branch",
  PR_COMMENTS: "pr_comments",
  CHANGES_REQUESTED: "changes_requested",
  MERGE_CONFLICT: "merge_conflict",
  PR_CLOSED: "pr_closed",
  MERGE_FAILED: "merge_failed",
} as const;

/** Command used for the optional repository refresh after a merged PR. */
export const REVIEW_GIT_PULL_COMMAND = ["git", "pull"] as const;

/** Default timeout when review callers do not supply a git-pull budget. */
export const DEFAULT_REVIEW_GIT_PULL_TIMEOUT_MS = 30_000;

/** Classified review observations consumed by heartbeat transition selection. */
export const REVIEW_OUTCOME = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  CONFLICT: "conflict",
  CLOSED_UNMERGED: "closed_unmerged",
  MISSING_PR: "missing_pr",
  PENDING: "pending",
  MERGE_FAILED: "merge_failed",
} as const;
