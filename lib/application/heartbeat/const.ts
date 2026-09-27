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

/** Diagnostics owned by heartbeat provider/metadata verification; unrelated errors survive its passes. */
export const HEARTBEAT_PROJECTION_ERROR = {
  METADATA_MISSING: "issue metadata is missing",
  METADATA_MISMATCH: "issue metadata does not match local issue state",
  FETCH_PREFIX: "provider issue fetch failed: ",
  MISSING_PREFIX: "provider_missing_pending:",
} as const;
