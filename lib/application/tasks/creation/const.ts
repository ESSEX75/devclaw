/** Names of durable checkpoints in the managed-task creation saga. */

import { ISSUE_CREATION_STATUS, ISSUE_INTEGRITY_STATUS } from "../../../domain/index.js";

/** Durable checkpoints persisted in each creation operation. */
export const CREATION_STEPS={
  PREFLIGHT: "preflight_completed",
  PROVIDER_STARTED: "provider_create_started",
  PROVIDER_CREATED: "provider_created",
  PROJECTION_VERIFIED: "projection_verified",
  LOCAL_COMMITTED: "local_state_committed",
  READY: "ready",
} as const;

/** Conservative provider request budget before starting creation. */
export const CREATION_REQUEST_BUDGET=4;

/** Retry delay when a throttled provider supplies no reset timestamp. */
export const CREATION_RETRY_DELAY_MS=60_000;

/** Audit events emitted while creating or recovering a managed issue. */
export const CREATION_EVENT={
  FAILED: "issue_creation_failed",
  LOCAL_STATE_COMMITTED: "issue_creation_local_state_committed",
  MANUAL_REPAIR_REQUIRED: "issue_creation_manual_repair_required",
  PREFLIGHT_COMPLETED: "issue_creation_preflight_completed",
  PROJECTION_STARTED: "issue_creation_projection_started",
  PROJECTION_VERIFIED: "issue_creation_projection_verified",
  PROVIDER_CREATED: "issue_creation_provider_created",
  PROVIDER_STARTED: "issue_creation_provider_started",
  READY: "issue_creation_ready",
  RECONCILED: "issue_creation_reconciled",
  RECONCILIATION_SCHEDULED: "issue_creation_reconciliation_scheduled",
  REQUESTED: "issue_creation_requested",
} as const;

/** Stable caller-facing readiness categories, distinct from durable checkpoints. */
export const CREATION_RESULT_STATUS = {
  READY: ISSUE_CREATION_STATUS.READY,
  PENDING: "pending",
  FAILED: "failed",
  MANUAL_REPAIR_REQUIRED: ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED,
} as const;

/** Projection readiness categories exposed by the creation result. */
export const CREATION_RESULT_INTEGRITY = { OK: ISSUE_INTEGRITY_STATUS.OK, PENDING: "pending", ERROR: "error" } as const;

/** Digest used to bind idempotency keys to immutable creation input. */
export const CREATION_PAYLOAD_HASH = "sha256";
