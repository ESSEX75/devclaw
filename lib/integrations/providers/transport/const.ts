/** Owns checked CLI protocol identifiers, collection limits and replay policies. */


/** Explicit replay safety selected by each provider operation. */
export const PROVIDER_COMMAND_MODE = {
  READ: "read",
  IDEMPOTENT: "idempotent",
  ONCE: "once",
} as const;

/** Transport limits shared by the concrete CLI adapters. */
export const PROVIDER_TRANSPORT_POLICY = {
  TIMEOUT_MS: 30_000,
  REMOTE_TIMEOUT_MS: 5_000,
  RETRIES: 3,
  INITIAL_DELAY_MS: 500,
  MAX_DELAY_MS: 5_000,
  BREAKER_FAILURES: 5,
  BREAKER_RESET_MS: 30_000,
} as const;

/** Page size used with provider-owned CLI pagination; abnormal completion never exposes partial results. */
export const PROVIDER_PAGE_SIZE = 100;

/** Concrete CLI identities used by shared checked transport. */
export const PROVIDER_CLI = {
  GITHUB: "gh",
  GITLAB: "glab",
} as const;

/** HTTP methods shared by provider CLI REST calls; replay safety is still explicitly chosen per operation. */
export const PROVIDER_HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
} as const;

/** Provider collection page-size query identifier. */
export const PROVIDER_PAGE_QUERY = "per_page";
