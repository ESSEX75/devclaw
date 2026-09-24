/**
 * Classifies provider create failures without guessing ambiguous mutation outcomes.
 */
import { ISSUE_CREATION_ERROR } from "../../../domain/index.js";
import { isProviderOperationError, PROVIDER_OPERATION_ERROR } from "../../../integrations/providers/index.js";
import type { IssueCreationFailure } from "../../../state/index.js";

/**
 * Map a provider mutation failure to a durable recovery decision.
 * Unclassified outcomes are unknown and never retried automatically.
 *
 * @param error - Untrusted provider mutation failure.
 */
export function creationFailureFromProvider(error: unknown): IssueCreationFailure {
  if (isProviderOperationError(error)) {
    if (error.outcomeUnknown) {
      return { code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN, message: error.message, retryable: false };
    }

    if (error.code === PROVIDER_OPERATION_ERROR.RATE_LIMITED) {
      return { code: ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED, message: error.message, retryable: true, retryAfter: error.retryAfter };
    }

    return { code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_FAILED, message: error.message, retryable: error.retryable };
  }

  return {
    code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

/** Carries a typed failure from provider projection verification. */
export class IssueCreationFailureError extends Error {
  /** Stable failure code and retry policy carried to the runner. */
  readonly failure: IssueCreationFailure;

  /**
   * Carry a typed projection verification failure through the saga runner.
   *
   * @param failure - Stable error stored on the operation.
   */
  constructor(failure: IssueCreationFailure) {
    super(failure.message);
    this.name = "IssueCreationFailureError";
    this.failure = failure;
  }
}
