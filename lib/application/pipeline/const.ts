/** Stable identifiers owned by pipeline orchestration and its audit trail. */

/** Command used for the best-effort checkout refresh during completion. */
export const PIPELINE_GIT_PULL_COMMAND = ["git", "pull"] as const;

/** Events written by completion coordination and provider actions. */
export const PIPELINE_AUDIT = {
  WARNING: "pipeline_warning",
  ACTION_FAILED: "pipeline_action_failed",
  TRANSITION: "pipeline_transition",
} as const;

/** Owners recorded by projection and archive operations. */
export const PIPELINE_OWNER = {
  COMPLETION: "pipeline_completion",
  MERGE_FAILURE: "pipeline_merge_failure",
} as const;

/** Correlation prefix shared by terminal archive attempts in pipeline transitions. */
export const PIPELINE_TERMINAL_ARCHIVE_CORRELATION_PREFIX = "terminal:";
