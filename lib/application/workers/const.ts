/** Timing policy for escalation of unresolved worker submissions. */

/** Time allowed for a gateway response before operator attention is required. */
export const DELIVERY_ATTENTION_AFTER_MS = 5 * 60 * 1_000;

/** Explicit operator conclusions accepted by worker-delivery recovery. */
export const WORKER_DELIVERY_RESOLUTION = {
  /** The operator verified this worker turn started. */
  CONFIRMED_STARTED: "confirmed-started",
  /** The operator verified this worker turn did not start. */
  CONFIRMED_NOT_STARTED: "confirmed-not-started",
} as const;
