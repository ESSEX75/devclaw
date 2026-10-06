/** Thresholds and messages shared by worker diagnosis and remediation. */

/** Recently started workers may not yet appear in the gateway snapshot. */
export const GRACE_PERIOD_MS = 5 * 60 * 1_000;

/** Small contexts indicate that the task may not have reached the worker. */
export const STALL_CONTEXT_THRESHOLD = 1_000;

/** Existing reminder sent only by explicit worker remediation. */
export const NUDGE_MESSAGE = `You appear to have stalled. Continue working on your current task. If you are blocked or unable to proceed, call work_finish with result "blocked".`;

/** Minimum interval between health nudge attempts for the same worker run. */
export const NUDGE_RETRY_INTERVAL_MS = 15 * 60 * 1_000;

/** Maximum wait for a nudge gateway response; an interruption leaves submission uncertain. */
export const NUDGE_COMMAND_TIMEOUT_MS = 10_000;

/** Stable remediation identifiers shared by diagnosis, execution, and pass reporting. */
export const HEALTH_ACTION = {
  RECONCILE_DELIVERY: "reconcile_delivery",
  RELEASE: "release",
  REQUEUE: "requeue",
  CLEAR_REFERENCE: "clear_reference",
  NUDGE: "nudge",
  RECONCILE_PROJECTION: "reconcile_projection",
} as const;

/** Conditions reported by heartbeat health diagnosis. */
export const HEALTH_ISSUE_TYPE = {
  SESSION_DEAD: "session_dead",
  INSPECTION_FAILED: "inspection_failed",
  LABEL_MISMATCH: "label_mismatch",
  STALE_WORKER: "stale_worker",
  STUCK_LABEL: "stuck_label",
  ORPHAN_ISSUE_ID: "orphan_issue_id",
  ISSUE_STATE_MISSING: "issue_state_missing",
  CONTEXT_OVERFLOW: "context_overflow",
  SESSION_STALLED: "session_stalled",
  DELIVERY_UNKNOWN: "delivery_unknown",
} as const;

/** Severity levels attached to heartbeat health findings. */
export const HEALTH_ISSUE_SEVERITY = {
  CRITICAL: "critical",
  WARNING: "warning",
} as const;
