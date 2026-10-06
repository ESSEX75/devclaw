/** Notification event, routing, and audit identifiers used by application use cases. */

import { COMPLETION_RESULT } from "../../domain/index.js";

/** Event identifiers accepted from plugin configuration. */
export const NOTIFICATION_EVENT = {
  PIPELINE_COMPLETE: "pipelineComplete",
  WORKER_START: "workerStart",
  WORKER_COMPLETE: "workerComplete",
  REVIEW_NEEDED: "reviewNeeded",
  PR_MERGED: "prMerged",
  CHANGES_REQUESTED: "changesRequested",
  MERGE_CONFLICT: "mergeConflict",
  PR_CLOSED: "prClosed",
} as const;

/** Event toggles accepted from plugin configuration. */
export const NOTIFICATION_EVENT_TYPES = Object.values(NOTIFICATION_EVENT);

/** Delivery prevented by application policy or invalid routing. */
export const NOTIFICATION_BLOCKED = "blocked";

/** Stable reasons shared by terminal notification send and retry paths. */
export const NOTIFICATION_BLOCK_REASON = {
  EVENT_DISABLED: "Notification event is disabled.",
  MISSING_ENDPOINT: "Stored notification endpoint is missing; restore the exact binding.",
} as const;

/** Paths that may merge a pull request before sending a notification. */
export const NOTIFICATION_MERGE_ACTOR = {
  HEARTBEAT: "heartbeat",
  AGENT: "agent",
  PIPELINE: "pipeline",
} as const;

/** Display text for each supported pull request merge path. */
export const MERGE_ACTOR_TEXT = {
  [NOTIFICATION_MERGE_ACTOR.HEARTBEAT]: "auto-merged after approval",
  [NOTIFICATION_MERGE_ACTOR.AGENT]: "merged by agent reviewer",
  [NOTIFICATION_MERGE_ACTOR.PIPELINE]: "merged by reviewer",
} as const;

/** Display text for built-in worker results; custom results retain their names. */
export const WORKER_RESULT_TEXT = {
  [COMPLETION_RESULT.DONE]: "completed",
  [COMPLETION_RESULT.PASS]: "PASSED",
  [COMPLETION_RESULT.FAIL]: "FAILED",
  [COMPLETION_RESULT.REFINE]: "needs refinement",
  [COMPLETION_RESULT.BLOCKED]: "BLOCKED",
} as const;

/** Provider URL path segment identifying a GitLab merge request. */
export const MERGE_REQUEST_PATH_SEGMENT = "merge_requests";

/** Provider URL pattern capturing a GitHub pull or GitLab merge request number. */
export const PULL_REQUEST_NUMBER_PATTERN = /\/(?:pull|merge_requests)\/(\d+)/;

/** Stable notification audit event identifiers. */
export const NOTIFICATION_AUDIT = {
  SKIP: "notify_skip",
  CONFIGURATION_ERROR: "notify_configuration_error",
  ATTEMPT: "notify_attempt",
  SENT: "notify_sent",
  FAILED: "notify_failed",
  UNKNOWN: "notify_unknown",
  RETRY_FAILED: "pipeline_notification_retry_failed",
} as const;

/** Routing and audit decisions made by the notification coordinator. */
export const NOTIFICATION_AUDIT_OUTCOME = {
  SKIP: "skip",
  CONFIGURATION_ERROR: "configuration_error",
  ATTEMPT: "attempt",
  SENT: "sent",
  FAILED: "failed",
} as const;
