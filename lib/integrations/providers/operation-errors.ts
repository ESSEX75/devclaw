/**
 * Classifies provider mutation failures into stable codes at the integration boundary.
 * Application sagas use these codes instead of inferring recovery safety from CLI text.
 */
import { normalizeProviderFailure } from "./failures.js";
import type { ProviderOperationErrorCode } from "./types.js";

export { PROVIDER_OPERATION_ERROR } from "./const.js";
export type { ProviderOperationErrorCode } from "./types.js";

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
  if (error instanceof ProviderOperationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const failure = normalizeProviderFailure(error);

  return new ProviderOperationError({ ...failure, message, cause: error });
}
