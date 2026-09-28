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

/** Built-in agent when no explicit inventory exists. */
export const HEARTBEAT_AGENT_ID = { MAIN: "main" } as const;

/** Scheduled service identity and startup delay. */
export const HEARTBEAT_SERVICE = { ID: "devclaw-heartbeat", STARTUP_DELAY_MS: 2_000 } as const;

/** Maximum creation recoveries per project maintenance pass. */
export const HEARTBEAT_CREATION_LIMIT = 20;

/** Confirmed provider absence must be observed repeatedly over a stable interval. */
export const HEARTBEAT_MISSING_CONFIRMATIONS = 3;

export const HEARTBEAT_MISSING_DURATION_MS = 15 * 60_000;

/** Audit operation emitted after one complete project sweep. */
export const HEARTBEAT_AUDIT_EVENT = {
  TICK: "heartbeat_tick",
  REVIEW_NOTIFICATION_ERROR: "heartbeat_review_notification_error",
} as const;

/** OpenClaw plugin setting read by the heartbeat configuration boundary. */
export const HEARTBEAT_CONFIG_KEY = "work_heartbeat";

/** Maximum signed 32-bit timer delay accepted by Node without interval rollover. */
export const HEARTBEAT_TIMER_MAX_MS = 2_147_483_647;
