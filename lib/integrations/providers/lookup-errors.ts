/**
 * Defines typed provider issue lookup failures at the integration boundary.
 * Application code consumes codes and never infers destructive meaning from error text.
 */

import { PROVIDER_ERROR_NAME, PROVIDER_ISSUE_LOOKUP_ERROR, PROVIDER_OPERATION_ERROR } from "./const.js";
import { normalizeProviderFailure } from "./failures.js";
import type { ProviderIssueLookupErrorCode, ProviderLookupErrorOptions } from "./types.js";

/** Typed failure emitted after a provider adapter classifies an issue lookup. */
export class ProviderIssueLookupError extends Error {
  /** Stable classified failure category consumed without parsing messages. */
  readonly code: ProviderIssueLookupErrorCode;
  /** Concrete provider owning the failed lookup. */
  readonly provider: string;
  /** Whether the explicitly replayable operation may be retried. */
  readonly retryable: boolean;
  /** Confirmed HTTP status when available. */
  readonly status?: number;

  /** Preserve classified read evidence without deriving lifecycle or deletion policy.
   * @param opts - Provider identity, classified category and original diagnostic.
   */
  constructor(opts: ProviderLookupErrorOptions) {
    super(opts.message, { cause: opts.cause });
    this.name = PROVIDER_ERROR_NAME.LOOKUP;
    this.code = opts.code;
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/** Classify non-missing transport and authorization failures inside an adapter.
 * @param provider - Concrete provider owning the failed observation.
 * @param error - Unknown failure whose existing classification must be preserved.
 */
export function classifyProviderLookupFailure(provider: string, error: unknown): ProviderIssueLookupError {
  if (error instanceof ProviderIssueLookupError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const failure = normalizeProviderFailure(error);
  const code = failure.code === PROVIDER_OPERATION_ERROR.NOT_FOUND
    || failure.code === PROVIDER_OPERATION_ERROR.CONFLICT || failure.code === PROVIDER_OPERATION_ERROR.VALIDATION_FAILED
    ? PROVIDER_ISSUE_LOOKUP_ERROR.UNKNOWN : failure.code;

  return new ProviderIssueLookupError({ code, provider, retryable: failure.retryable, message, status: failure.status, cause: error });
}

/** Classify a failed repository/project probe while preserving auth, rate, and transport codes.
 * @param provider - Concrete provider owning the failed observation.
 * @param error - Unknown failure whose existing classification must be preserved.
 */
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

/** Identify a provider CLI response that warrants a separate repository-access check.
 * @param error - Unknown failure whose existing classification must be preserved.
 */
export function mayBeMissingProviderIssue(error: unknown): boolean {
  const failure = normalizeProviderFailure(error);

  return failure.code === PROVIDER_OPERATION_ERROR.NOT_FOUND && !failure.outcomeUnknown;
}
