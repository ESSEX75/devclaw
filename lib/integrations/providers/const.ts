/** Provider DTO discriminants shared by adapters and application consumers. */

/** Source namespace of PR feedback; numeric IDs are not interchangeable between these sources. */
export const PR_COMMENT_KIND = { REVIEW: "review", INLINE: "inline", CONVERSATION: "conversation" } as const;

/** Canonical issue state used when comparing provider values without regard to case. */
export const PROVIDER_ISSUE_STATE = { CLOSED: "closed" } as const;

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

/** Stable mutation and normalized transport failure categories. */
export const PROVIDER_OPERATION_ERROR = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  TRANSIENT: "TRANSIENT",
  UNKNOWN: "UNKNOWN",
} as const;

/** Known GitHub origin hosts; other hosts require explicit provider selection. */
export const GITHUB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["github.com", "ssh.github.com"]);

/** Known GitLab origin hosts; self-hosted installations require explicit selection. */
export const GITLAB_ORIGIN_HOSTS: ReadonlySet<string> = new Set(["gitlab.com"]);
