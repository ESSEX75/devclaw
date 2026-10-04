/** Defines queue-owned diagnostic codes and pure planning outcomes. */

/** Stable explanations for queue constraints, independent of provider lookup error codes. */
export const QUEUE_REASON = {
  ROLE_UNAVAILABLE: "role_unavailable",
  PICKUP_LIMIT: "pickup_limit",
  SEQUENTIAL: "sequential_role_active",
  DISPATCH_FAILED: "dispatch_failed",
  REVIEW_POLICY: "review_policy",
  TEST_POLICY: "test_policy",
  CAPACITY: "capacity_exhausted",
} as const;

/** Discriminants for the queue's pure slot plan. */
export const QUEUE_PLAN = {
  BLOCKED: "blocked",
  READY: "ready"
} as const;
