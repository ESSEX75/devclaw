/** Owns fallback runtime policy values applied while completing merged configuration. */

/** Default capacity for a configured level without a per-level or workflow override. */
export const DEFAULT_MAX_WORKERS_PER_LEVEL = 2;

/** Complete runtime timeouts used when merged configuration omits an optional override. */
export const DEFAULT_TIMEOUTS = {
  gitPullMs: 30_000,
  gatewayMs: 15_000,
  sessionPatchMs: 30_000,
  dispatchMs: 600_000,
  staleWorkerHours: 2,
  sessionContextBudget: 0.6,
  stallTimeoutMinutes: 15,
} as const;

/** Archive maintenance policy used when configuration omits an optional override. */
export const DEFAULT_ISSUE_ARCHIVE_MAINTENANCE = {
  deletedProviderRetention: "90d",
  archiveRetention: "365d",
  attachmentsRetention: "90d",
  maxPerHeartbeat: 100,
} as const;
