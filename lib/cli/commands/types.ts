/** Parsed options owned by the worker-delivery command adapter. */

/** Raw Commander values validated before calling application recovery. */
export type WorkerDeliveryCommandOptions = {
  /** Canonical project slug supplied by the operator. */
  project: string;
  /** Raw positive issue identifier. */
  issue: string;
  /** Exact reusable session identity. */
  sessionKey: string;
  /** Exact unresolved submission identity. */
  deliveryId: string;
  /** Operator decision validated against domain values. */
  decision: string;
  /** Evidence supporting the operator conclusion. */
  reason: string;
  /** Preview without effects. */
  dryRun?: boolean;
  /** Apply or resume the verified decision. */
  apply?: boolean;
  /** Explicit workspace overriding configured defaults. */
  workspace?: string;
};
