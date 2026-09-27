/** Timing policy for escalation of unresolved worker submissions. */

/** Time allowed for a gateway response before operator attention is required. */
export const DELIVERY_ATTENTION_AFTER_MS = 5 * 60 * 1_000;

/** Brief observation window; an expired window never means delivery failed. */
export const DELIVERY_ACCEPTANCE_WINDOW_MS = 25;

/** Timeout for read-only gateway evidence during reconciliation. */
export const DELIVERY_INSPECTION_TIMEOUT_MS = 5_000;

/** Whether dispatch creates a session or reuses an existing one. */
export const WORKER_SESSION_ACTION = { SPAWN: "spawn", SEND: "send" } as const;

/** Stable events written by worker commands and delivery recovery. */
export const WORKER_AUDIT_EVENT = {
  DISPATCH: "dispatch", WARNING: "dispatch_warning", MODEL_SELECTION: "model_selection",
  FINISHED: "work_finish", FINISH_REJECTED: "work_finish_rejected",
  DELIVERY_RESOLVED: "dispatch_delivery_resolved", DELIVERY_UNKNOWN: "dispatch_delivery_unknown",
  DELIVERY_ATTENTION: "dispatch_delivery_needs_attention",
} as const;

/** Local rejection identities consumed by diagnostics. */
export const WORKER_REJECTION_REASON = { MISSING_ACTIVE_WORKER: "missing_active_worker" } as const;

/** Projection owner recorded when dispatch commits local runtime state. */
export const WORKER_DISPATCH_OWNER = "worker_dispatch";
