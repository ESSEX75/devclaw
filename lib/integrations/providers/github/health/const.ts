/** Owns GitHub authentication and quota observations identifiers and policies used by this capability. */

/** Provider quota endpoint owned by authentication/health observations. */
export const GITHUB_HEALTH_QUERY = {
  RATE_LIMIT: "rate_limit",
} as const;

/** GitHub rate-limit reset timestamps are expressed in epoch seconds. */
export const GITHUB_EPOCH_SECOND_MS = 1_000;
