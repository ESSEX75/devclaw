/** Provider DTO discriminants shared by adapters and application consumers. */

/** Source namespace of PR feedback; numeric IDs are not interchangeable between these sources. */
export const PR_COMMENT_KIND = {
  REVIEW: "review",
  INLINE: "inline",
  CONVERSATION: "conversation",
} as const;

/** Canonical issue state used when comparing provider values without regard to case. */
export const PROVIDER_ISSUE_STATE = {
  CLOSED: "closed",
} as const;

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

/** Page size used with provider-owned CLI pagination; abnormal completion never exposes partial results. */
export const PROVIDER_PAGE_SIZE = 100;

/** Remote tracking namespace inspected by the direct-commit observation. */
export const PROVIDER_HISTORY_REMOTE = "origin";

/** Git history output contains only confirmed matching commit identifiers. */
export const PROVIDER_HISTORY_FORMAT = "%H";

/** Provider review decisions consumed independently of their source namespace. */
export const PROVIDER_REVIEW_STATE = {
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  COMMENTED: "COMMENTED",
  DISMISSED: "DISMISSED",
} as const;

/** Isolated upload staging resources; display names never become directory paths. */
export const PROVIDER_ATTACHMENT_STORAGE = {
  FALLBACK_NAME: "file",
  MAX_NAME_LENGTH: 180,
} as const;

/** Provider-neutral lifecycle and review observation states. */
export const PR_STATE = {
  OPEN: "open",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  HAS_COMMENTS: "has_comments",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

/** Concrete CLI identities used by shared checked transport. */
export const PROVIDER_CLI = {
  GITHUB: "gh",
  GITLAB: "glab",
} as const;

/** Read-failure categories consumed by application without parsing provider diagnostics. */
export const PROVIDER_ISSUE_LOOKUP_ERROR = {
  ISSUE_NOT_FOUND: "ISSUE_NOT_FOUND",
  PROJECT_NOT_FOUND_OR_FORBIDDEN: "PROJECT_NOT_FOUND_OR_FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  TRANSIENT: "TRANSIENT",
  UNKNOWN: "UNKNOWN",
} as const;

/** HTTP categories recognized in provider transport diagnostics. */
export const PROVIDER_HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;

/** Non-formal feedback kinds retained in normalized provider comment state. */
export const PROVIDER_FEEDBACK_STATE = {
  INLINE: "INLINE",
  UNRESOLVED: "UNRESOLVED",
} as const;

/** Provider-side collection filters, independent of configured workflow labels. */
export const PROVIDER_COLLECTION_STATE = {
  OPEN: "open",
  CLOSED: "closed",
  ALL: "all",
} as const;

/** Numeric status fragments recognized only in actual transport diagnostics. */
export const PROVIDER_HTTP_STATUS_PATTERN = /\b(401|403|404|409|422|429|5\d\d)\b/;

/** Error instance names used in diagnostic serialization. */
export const PROVIDER_ERROR_NAME = {
  LOOKUP: "ProviderIssueLookupError",
  OPERATION: "ProviderOperationError",
  TRANSPORT: "ProviderTransportError",
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
