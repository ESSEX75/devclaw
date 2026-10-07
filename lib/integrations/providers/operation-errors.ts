/**
 * Classifies provider mutation failures into stable codes at the integration boundary.
 * Application sagas use these codes instead of inferring recovery safety from CLI text.
 */

import { PROVIDER_ERROR_NAME } from "./const.js";
import { normalizeProviderFailure } from "./failures.js";
import type { ProviderOperationErrorCode, ProviderOperationErrorOptions } from "./types.js";

/** Typed provider mutation failure with retry and request-outcome semantics. */
export class ProviderOperationError extends Error {
  /** Stable classified failure category consumed without parsing messages. */
  readonly code: ProviderOperationErrorCode;
  /** Whether the explicitly replayable operation may be retried. */
  readonly retryable: boolean;
  /** Whether the submitted mutation may already have taken effect. */
  readonly outcomeUnknown: boolean;
  /** Provider-supplied retry delay when available. */
  readonly retryAfter?: string;

  /** Preserve mutation replayability and unknown-outcome evidence through outer classification.
   * @param opts - Classified command outcome and diagnostic context.
   */
  constructor(opts: ProviderOperationErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = PROVIDER_ERROR_NAME.OPERATION;
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.outcomeUnknown = opts.outcomeUnknown ?? false;
    this.retryAfter = opts.retryAfter;
  }
}

/** Classify a failed provider mutation conservatively, treating transport failures as outcome-unknown.
 * @param error - Unknown failure whose existing classification must be preserved.
 */
export function classifyProviderOperationError(error: unknown): ProviderOperationError {
  if (error instanceof ProviderOperationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const failure = normalizeProviderFailure(error);

  return new ProviderOperationError({ ...failure, message, cause: error });
}
