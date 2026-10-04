/** Stable sources and failure codes for managed issue repair. */

/** Authoritative snapshot selected for a repair operation. */
export const ISSUE_REPAIR_SOURCE = {
  LOCAL_STATE: "local-state",
  PROVIDER: "provider",
} as const;

/** Stable repair failure identifiers exposed by every adapter. */
export const ISSUE_REPAIR_ERROR = {
  INVALID_INPUT: "INVALID_INPUT",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  ISSUE_NOT_FOUND: "ISSUE_NOT_FOUND",
  LOCAL_STATE_NOT_FOUND: "LOCAL_STATE_NOT_FOUND",
  SOURCE_INCOMPLETE: "SOURCE_INCOMPLETE",
  SOURCE_AMBIGUOUS: "SOURCE_AMBIGUOUS",
  ISSUE_IDENTITY_MISMATCH: "ISSUE_IDENTITY_MISMATCH",
  ACTIVE_WORKER: "ACTIVE_WORKER",
  PLAN_STALE: "PLAN_STALE",
  RATE_LIMIT_PRECHECK_FAILED: "RATE_LIMIT_PRECHECK_FAILED",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_FORBIDDEN: "PROVIDER_FORBIDDEN",
  PROVIDER_TRANSIENT_ERROR: "PROVIDER_TRANSIENT_ERROR",
  REPAIR_APPLY_FAILED: "REPAIR_APPLY_FAILED",
  REPAIR_VERIFICATION_FAILED: "REPAIR_VERIFICATION_FAILED",
} as const;

/** Operator-selected repair execution mode. */
export const REPAIR_MODE = {
  APPLY: "apply",
  DRY_RUN: "dry_run",
} as const;

/** Stable repair outcomes exposed to adapters. */
export const REPAIR_STATUS = {
  PLANNED: "planned",
  REPAIRED: "repaired",
  ALREADY_CONSISTENT: "already_consistent",
  BLOCKED: "blocked",
  PARTIAL_FAILURE: "partial_failure",
} as const;

/** Planned metadata replacement decisions. */
export const REPAIR_METADATA_ACTION = {
  NONE: "none",
  REPLACE: "replace",
} as const;

/** Stable planned and applied repair operations. */
export const REPAIR_ACTION = {
  ENSURE_MANAGED_LABELS_EXIST: "ensure_managed_labels_exist",
  ADD_MISSING_MANAGED_LABELS: "add_missing_managed_labels",
  REMOVE_UNEXPECTED_MANAGED_LABELS: "remove_unexpected_managed_labels",
  REPLACE_MANAGED_METADATA: "replace_managed_metadata",
  VERIFY_PROVIDER_PROJECTION: "verify_provider_projection",
  UPDATE_ALLOWED_LOCAL_FIELDS: "update_allowed_local_fields",
} as const;

/** Local runtime fields that explicit provider-source repair may import. */
export const REPAIR_LOCAL_FIELDS = [
  "workflowState", "workflowLabel", "assignedRole", "assignedLevel",
  "owner", "reviewPolicy", "testPolicy", "notifyTarget",
] as const;

/** Audit checkpoints for repair execution and verification. */
export const REPAIR_EVENT = {
  DRY_RUN: "issue_repair_dry_run",
  VERIFIED: "issue_repair_verified",
  COMPLETED: "issue_repair_completed",
  REQUESTED: "issue_repair_requested",
  APPLY_STARTED: "issue_repair_apply_started",
  PROVIDER_UPDATED: "issue_repair_provider_updated",
  PARTIAL_FAILURE: "issue_repair_partial_failure",
  FAILED: "issue_repair_failed",
} as const;

/** Nonfatal quota availability diagnostics. */
export const REPAIR_WARNING = {
  PRECHECK_UNAVAILABLE: "RATE_LIMIT_PRECHECK_UNAVAILABLE",
  STATUS_UNAVAILABLE: "RATE_LIMIT_STATUS_UNAVAILABLE",
} as const;

/** Digest algorithm binding repair plans to their exact snapshots. */
export const REPAIR_PLAN_HASH_ALGORITHM = "sha256";
