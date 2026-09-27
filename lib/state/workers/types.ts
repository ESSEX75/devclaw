/** Defines durable operator decisions for one exact worker submission. */

import type { WORKER_DELIVERY_RESOLUTION } from "../../domain/index.js";
import type { ValueOf } from "../../types.js";

/** Recovery intent retained until both local ownership views have settled. */
export type WorkerDeliveryResolution = {
  /** Submission token distinct from a reused session key. */
  deliveryId: string;
  /** Provider-local issue addressed by the decision. */
  issueId: number;
  /** Exact worker session selected by the operator. */
  sessionKey: string;
  /** Role owning the reserved slot. */
  role: string;
  /** Level containing the reserved slot. */
  level: string;
  /** Concrete slot position. */
  slotIndex: number;
  /** Project slot start time captured before effects. */
  startedAt: string;
  /** Operator's verified conclusion, immutable once recorded. */
  decision: ValueOf<typeof WORKER_DELIVERY_RESOLUTION>;
  /** Evidence recorded before any effect. */
  reason: string;
  /** Local source key captured before effects. */
  fromState: string;
  /** Source provider label captured before effects. */
  fromLabel: string;
  /** Validated destination key. */
  toState: string;
  /** Validated destination provider label. */
  toLabel: string;
  /** True only after slot and issue updates succeeded. */
  completed: boolean;
};
