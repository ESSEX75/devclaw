/** Stable identifiers for the ordered heartbeat maintenance passes. */
export const HEARTBEAT_PASS = {
  CREATION: "creation",
  PROJECTION: "projection",
  ARCHIVE: "archive",
  HEALTH: "health",
  REVIEW: "review",
  REVIEW_SKIP: "review_skip",
  TEST_SKIP: "test_skip",
} as const;
