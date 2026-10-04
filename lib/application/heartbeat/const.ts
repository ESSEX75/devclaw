/** Stable identifiers for the ordered heartbeat maintenance passes. */
export const HEARTBEAT_PASS = {
  CREATION: "creation",
  PROJECTION: "projection",
  ARCHIVE: "archive",
  HEALTH: "health",
  REVIEW: "review",
  REVIEW_SKIP: "review_skip",
  TEST_SKIP: "test_skip",
} as const;

/** Whether a failed pass stops the project phase or allows independent passes to run. */
export const HEARTBEAT_PASS_FAILURE_POLICY = { STOP: "stop", CONTINUE: "continue" } as const;

/** Actions reported by heartbeat projection integrity inspection. */
export const PROJECTION_INTEGRITY_ACTION = {
  LABEL_REPAIR: "label_repair",
  METADATA_ERROR: "metadata_error",
  PROVIDER_MISSING: "provider_missing",
  PROVIDER_FETCH_ERROR: "provider_fetch_error",
} as const;

/** Diagnostics owned by heartbeat provider/metadata verification; unrelated errors survive its passes. */
export const HEARTBEAT_PROJECTION_ERROR = {
  METADATA_MISSING: "issue metadata is missing",
  METADATA_MISMATCH: "issue metadata does not match local issue state",
  FETCH_PREFIX: "provider issue fetch failed: ",
  MISSING_PREFIX: "provider_missing_pending:",
} as const;

/** Audit events emitted while validating the provider projection. */
export const HEARTBEAT_PROJECTION_AUDIT_EVENT = {
  PROVIDER_DELETED_DETECTED: "issue_provider_deleted_detected",
  INTEGRITY_ERROR: "issue_projection_integrity_error",
  LABEL_REPAIR: "issue_projection_label_repair",
} as const;

/** Actor and projection owner recorded for heartbeat initiated changes. */
export const HEARTBEAT_PROJECTION_OWNER = {
  INSPECTION: "heartbeat_projection",
  REPAIR: "heartbeat_projection_repair",
} as const;

/** Stable audit reasons for provider absence and metadata verification failures. */
export const HEARTBEAT_PROJECTION_AUDIT_REASON = {
  ISSUE_NOT_FOUND: "confirmed_issue_not_found",
  PROVIDER_FETCH_ERROR: PROJECTION_INTEGRITY_ACTION.PROVIDER_FETCH_ERROR,
  METADATA_MISSING: "metadata_missing",
  METADATA_MISMATCH: "metadata_mismatch",
} as const;

/** Prefix shared by deletion detection and the corresponding archive operation. */
export const HEARTBEAT_PROVIDER_DELETED_CORRELATION_PREFIX = "provider-deleted:";

/** Maximum creation recoveries per project maintenance pass. */
export const HEARTBEAT_CREATION_LIMIT = 20;

/** Confirmed provider absence must be observed repeatedly over a stable interval. */
export const HEARTBEAT_MISSING_CONFIRMATIONS = 3;

export const HEARTBEAT_MISSING_DURATION_MS = 15 * 60_000;

/** Audit operation emitted after one complete project sweep. */
export const HEARTBEAT_AUDIT_EVENT = {
  TICK: "heartbeat_tick",
  REVIEW_NOTIFICATION_ERROR: "heartbeat_review_notification_error",
} as const;
