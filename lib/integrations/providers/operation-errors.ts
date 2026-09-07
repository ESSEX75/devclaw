/**
 * Classifies provider mutation failures into stable codes at the integration boundary.
 * Application sagas use these codes instead of inferring recovery safety from CLI text.
 */
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

/** Stable provider mutation failure code. */
export type ProviderOperationErrorCode = typeof PROVIDER_OPERATION_ERROR[keyof typeof PROVIDER_OPERATION_ERROR];

/** Typed provider mutation failure with retry and request-outcome semantics. */
export class ProviderOperationError extends Error {
  readonly code: ProviderOperationErrorCode;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly retryAfter?: string;

  constructor(opts: {
    code: ProviderOperationErrorCode;
    message: string;
    retryable: boolean;
    outcomeUnknown?: boolean;
    retryAfter?: string;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = "ProviderOperationError";
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.outcomeUnknown = opts.outcomeUnknown ?? false;
    this.retryAfter = opts.retryAfter;
  }
}

/** Check whether a caught value is a classified provider mutation failure. */
export function isProviderOperationError(error: unknown): error is ProviderOperationError {
  return error instanceof ProviderOperationError;
}

/** Classify a failed provider mutation conservatively, treating transport failures as outcome-unknown. */
export function classifyProviderOperationError(error: unknown): ProviderOperationError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("401") || normalized.includes("unauthorized") || normalized.includes("authentication")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.UNAUTHORIZED, message, retryable: false, cause: error });
  }

  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.RATE_LIMITED, message, retryable: true, cause: error });
  }

  if (normalized.includes("403") || normalized.includes("forbidden")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.FORBIDDEN, message, retryable: false, cause: error });
  }

  if (normalized.includes("422") || normalized.includes("validation") || normalized.includes("invalid")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.VALIDATION_FAILED, message, retryable: false, cause: error });
  }

  if (normalized.includes("409") || normalized.includes("conflict")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.CONFLICT, message, retryable: false, cause: error });
  }

  if (normalized.includes("404") || normalized.includes("not found")) {
    return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.NOT_FOUND, message, retryable: false, cause: error });
  }

  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("network") || normalized.includes("dns")) {
    return new ProviderOperationError({
      code: PROVIDER_OPERATION_ERROR.TRANSIENT,
      message,
      retryable: true,
      outcomeUnknown: true,
      cause: error,
    });
  }

  return new ProviderOperationError({ code: PROVIDER_OPERATION_ERROR.UNKNOWN, message, retryable: false, outcomeUnknown: true, cause: error });
}
