/**
 * Defines typed provider issue lookup failures at the integration boundary.
 * Application code consumes codes and never infers destructive meaning from error text.
 */
export const PROVIDER_ISSUE_LOOKUP_ERROR = {
  ISSUE_NOT_FOUND: "ISSUE_NOT_FOUND",
  PROJECT_NOT_FOUND_OR_FORBIDDEN: "PROJECT_NOT_FOUND_OR_FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  TRANSIENT: "TRANSIENT",
  UNKNOWN: "UNKNOWN",
} as const;

/** Stable failure code used by application logic without parsing provider messages. */
export type ProviderIssueLookupErrorCode = typeof PROVIDER_ISSUE_LOOKUP_ERROR[keyof typeof PROVIDER_ISSUE_LOOKUP_ERROR];

/** Typed failure emitted after a provider adapter classifies an issue lookup. */
export class ProviderIssueLookupError extends Error {
  readonly code: ProviderIssueLookupErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(opts: {
    code: ProviderIssueLookupErrorCode;
    provider: string;
    retryable: boolean;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "ProviderIssueLookupError";
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/** Check whether a caught value is a classified provider lookup failure. */
export function isProviderIssueLookupError(error: unknown): error is ProviderIssueLookupError {
  return error instanceof ProviderIssueLookupError;
}

/** Classify non-missing transport and authorization failures inside an adapter. */
export function classifyProviderLookupFailure(provider: string, error: unknown): ProviderIssueLookupError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("401") || normalized.includes("unauthorized") || normalized.includes("authentication")) {
    return new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNAUTHORIZED, provider, retryable: false, message, status: 401, cause: error });
  }

  if (normalized.includes("403") || normalized.includes("forbidden")) {
    return new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.FORBIDDEN, provider, retryable: false, message, status: 403, cause: error });
  }

  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.RATE_LIMITED, provider, retryable: true, message, status: 429, cause: error });
  }

  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("network") || normalized.includes("dns")) {
    return new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.TRANSIENT, provider, retryable: true, message, cause: error });
  }

  return new ProviderIssueLookupError({ code: PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN, provider, retryable: false, message, cause: error });
}

/** Classify a failed repository/project probe while preserving auth, rate, and transport codes. */
export function classifyProviderProjectAccessFailure(provider: string, error: unknown): ProviderIssueLookupError {
  const classified = classifyProviderLookupFailure(provider, error);

  if (classified.code !== PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN) return classified;

  return new ProviderIssueLookupError({
    code: PROVIDER_ISSUE_LOOKUP_ERROR.PROJECT_NOT_FOUND_OR_FORBIDDEN,
    provider,
    retryable: false,
    message: `${provider} project access could not be confirmed.`,
    cause: error,
  });
}

/** Identify a provider CLI response that warrants a separate repository-access check. */
export function mayBeMissingProviderIssue(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return message.includes("404") || message.includes("not found") || message.includes("could not resolve to an issue") || message.includes("does not exist");
}
