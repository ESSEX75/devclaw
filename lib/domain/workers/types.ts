/** Shared issue and slot contract for an unresolved worker submission. */
import type { ValueOf } from "../../types.js";
import { WORKER_DELIVERY_STATUS } from "./const.js";

/** Durable evidence that a worker-turn submission has no confirmed outcome. */
export type WorkerDeliveryState = {
  /** Current investigation stage; only explicit success removes this marker. */
  status: ValueOf<typeof WORKER_DELIVERY_STATUS>;
  /** First reservation or uncertain response time in ISO format. */
  recordedAt: string;
  /** Diagnostic explaining the latest uncertainty. */
  reason: string;
  /** Most recent reconciliation time, when available. */
  checkedAt?: string;
  /** Whether the gateway session was observed; existence does not prove turn acceptance. */
  sessionObserved?: boolean | null;
};
