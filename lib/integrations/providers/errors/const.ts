/** Owns stable failure categories and diagnostic classification identifiers. */


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

/** Numeric status fragments recognized only in actual transport diagnostics. */
export const PROVIDER_HTTP_STATUS_PATTERN = /\b(401|403|404|409|422|429|5\d\d)\b/;

/** Error instance names used in diagnostic serialization. */
export const PROVIDER_ERROR_NAME = {
  LOOKUP: "ProviderIssueLookupError",
  OPERATION: "ProviderOperationError",
  TRANSPORT: "ProviderTransportError",
} as const;
