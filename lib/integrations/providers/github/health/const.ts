/** Owns github/health const contracts at the concrete provider boundary. */

/** Provider quota endpoint owned by authentication/health observations. */
export const GITHUB_HEALTH_QUERY = {
  RATE_LIMIT: "rate_limit",
} as const;

/** GitHub rate-limit reset timestamps are expressed in epoch seconds. */
export const GITHUB_EPOCH_SECOND_MS = 1_000;
