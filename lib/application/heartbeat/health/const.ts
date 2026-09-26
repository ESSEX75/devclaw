/** Thresholds and messages shared by worker diagnosis and remediation. */
/** Recently started workers may not yet appear in the gateway snapshot. */
export const GRACE_PERIOD_MS = 5 * 60 * 1_000;
/** Small contexts indicate that the task may not have reached the worker. */
export const STALL_CONTEXT_THRESHOLD = 1_000;
/** Existing reminder sent only by explicit worker remediation. */
export const NUDGE_MESSAGE = `You appear to have stalled. Continue working on your current task. If you are blocked or unable to proceed, call work_finish with result "blocked".`;

/** Stable remediation identifiers shared by diagnosis, execution, and pass reporting. */
export const HEALTH_ACTION = {
  RECONCILE_DELIVERY: "reconcile_delivery",
  RELEASE: "release",
  REQUEUE: "requeue",
  CLEAR_REFERENCE: "clear_reference",
  NUDGE: "nudge",
  RECONCILE_PROJECTION: "reconcile_projection",
} as const;
