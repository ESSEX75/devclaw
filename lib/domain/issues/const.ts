/**
 * issues/const.ts — Issue constants.
 */

/** Supported issue tracking provider constants. */
export const ISSUE_PROVIDER = {
  /** GitHub issue tracker provider. */
  GITHUB: "github",
  /** GitLab issue tracker provider. */
  GITLAB: "gitlab",
} as const;

/** Prefix used for instance ownership labels. */
export const OWNER_LABEL_PREFIX = "owner:";

/** Color used for instance ownership labels. */
export const OWNER_LABEL_COLOR = "#e4e4e4";

/** Status constants of local issue state integrity relative to the provider. */
export const ISSUE_INTEGRITY_STATUS = {
  /** Projection is synchronized and valid. */
  OK: "ok",
  /** Projection state has not been initialized yet. */
  PROJECTION_UNINITIALIZED: "projection_uninitialized",
  /** Drift detected between local runtime state and provider projection. */
  PROJECTION_DRIFT: "projection_drift",
  /** Severe state or data integrity error. */
  INTEGRITY_ERROR: "integrity_error",
} as const;

/** Persistence states for a terminal pipeline notification. */
export const PIPELINE_NOTIFICATION_STATUS = {
  /** Delivery has been reserved but is not yet confirmed. */
  ATTEMPTING: "attempting",
  /** The notification adapter confirmed delivery. */
  DELIVERED: "delivered",
} as const;

/** Reasons a managed issue leaves the active runtime store. */
export const ISSUE_ARCHIVE_REASON = {
  /** The workflow reached a final terminal state. */
  TERMINAL: "terminal",
  /** The provider confirmed that the issue was deleted. */
  PROVIDER_DELETED: "provider_deleted",
  /** An explicit project cleanup archived the issue. */
  PROJECT_CLEANUP: "project_cleanup",
} as const;

/** Retention state of attachments associated with an archived issue. */
export const ATTACHMENT_DISPOSITION = {
  RETAINED: "retained",
  PURGED: "purged",
  NONE: "none",
} as const;

/** Durable stages of a managed provider issue creation saga. */
export const ISSUE_CREATION_STATUS = {
  /** Local operation exists and provider creation has not been confirmed. */
  CREATING: "creating",
  /** Provider returned a stable issue identity. */
  PROVIDER_CREATED: "provider_created",
  /** Provider read-back matches the complete expected projection. */
  PROJECTION_VERIFIED: "projection_verified",
  /** Final local runtime state is committed and visible to lifecycle scans. */
  READY: "ready",
  /** A retryable or definitive pre-provider failure prevented readiness. */
  CREATION_FAILED: "creation_failed",
  /** Recovery cannot safely continue without an explicit operator decision. */
  MANUAL_REPAIR_REQUIRED: "manual_repair_required",
} as const;

/** Stable creation saga failure identifiers. */
export const ISSUE_CREATION_ERROR = {
  CREATE_PREFLIGHT_FAILED: "CREATE_PREFLIGHT_FAILED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  PROVIDER_CREATE_FAILED: "PROVIDER_CREATE_FAILED",
  PROVIDER_CREATE_UNKNOWN: "PROVIDER_CREATE_UNKNOWN",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROJECTION_APPLY_FAILED: "PROJECTION_APPLY_FAILED",
  PROJECTION_VERIFICATION_FAILED: "PROJECTION_VERIFICATION_FAILED",
  LOCAL_COMMIT_FAILED: "LOCAL_COMMIT_FAILED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
  MANUAL_REPAIR_REQUIRED: "MANUAL_REPAIR_REQUIRED",
} as const;
