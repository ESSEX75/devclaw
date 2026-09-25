/** Shared lifecycle identifiers for a worker turn whose delivery is unresolved. */

/** Durable worker-turn submission states used by issue and slot records. */
export const WORKER_DELIVERY_STATUS = {
  /** The slot is reserved before the gateway command begins. */
  SUBMITTING: "submitting",
  /** The gateway command is still running and may complete normally. */
  PENDING: "pending",
  /** The command outcome cannot prove whether the worker started. */
  UNKNOWN: "unknown",
  /** The unresolved turn has exceeded the investigation grace period. */
  NEEDS_ATTENTION: "needs_attention",
} as const;
