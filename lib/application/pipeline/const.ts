/** Stable identifiers owned by pipeline orchestration and its audit trail. */

/** Events written by completion coordination and provider actions. */
export const PIPELINE_AUDIT = {
  WARNING: "pipeline_warning", ACTION_FAILED: "pipeline_action_failed", TRANSITION: "pipeline_transition",
} as const;

/** Owners recorded by projection and archive operations. */
export const PIPELINE_OWNER = { COMPLETION: "pipeline_completion", MERGE_FAILURE: "pipeline_merge_failure" } as const;

/** Classified review observations consumed by heartbeat transition selection. */
export const REVIEW_OUTCOME = {
  APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", CONFLICT: "conflict",
  CLOSED_UNMERGED: "closed_unmerged", MISSING_PR: "missing_pr", PENDING: "pending", MERGE_FAILED: "merge_failed",
} as const;
