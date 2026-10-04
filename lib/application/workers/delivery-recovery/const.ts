/** Identifiers and policy values owned by worker delivery-recovery. */

/** Time allowed for a gateway response before operator attention is required. */
export const DELIVERY_ATTENTION_AFTER_MS = 5 * 60 * 1_000;

/** Timeout for read-only gateway evidence during reconciliation. */
export const DELIVERY_INSPECTION_TIMEOUT_MS = 5_000;
