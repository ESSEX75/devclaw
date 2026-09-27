/** Notification event policy and application outcome identifiers. */

/** Event identifiers accepted from plugin configuration. */
export const NOTIFICATION_EVENT = {
  PIPELINE_COMPLETE: "pipelineComplete", WORKER_START: "workerStart", WORKER_COMPLETE: "workerComplete",
  REVIEW_NEEDED: "reviewNeeded", PR_MERGED: "prMerged", CHANGES_REQUESTED: "changesRequested",
  MERGE_CONFLICT: "mergeConflict", PR_CLOSED: "prClosed",
} as const;

/** Event toggles accepted from plugin configuration. */
export const NOTIFICATION_EVENT_TYPES = Object.values(NOTIFICATION_EVENT);

/** Delivery prevented by application policy or invalid routing. */
export const NOTIFICATION_BLOCKED = "blocked";

/** Stable notification audit event identifiers. */
export const NOTIFICATION_AUDIT = {
  SKIP: "notify_skip", CONFIGURATION_ERROR: "notify_configuration_error", ATTEMPT: "notify_attempt",
  SENT: "notify_sent", FAILED: "notify_failed", UNKNOWN: "notify_unknown", RETRY_FAILED: "pipeline_notification_retry_failed",
} as const;

/** Routing and audit decisions made by the notification coordinator. */
export const NOTIFICATION_AUDIT_OUTCOME = { SKIP: "skip", CONFIGURATION_ERROR: "configuration_error", ATTEMPT: "attempt", SENT: "sent", FAILED: "failed" } as const;
