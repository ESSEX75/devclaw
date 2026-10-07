/** Normalizes external failure evidence once for read classification and mutation recovery. */

import { z } from "zod";

import { PROVIDER_ERROR_NAME, PROVIDER_HTTP_STATUS, PROVIDER_HTTP_STATUS_PATTERN, PROVIDER_OPERATION_ERROR } from "./const.js";
import type { ProviderTransportFailure } from "./types.js";

/** Carries transport evidence that must survive outer lookup and mutation classification. */
export class ProviderTransportError extends Error {
  /** Normalized evidence from the failed process or lost response. */
  readonly failure: ProviderTransportFailure;

  /** Preserve the original command diagnostic and normalized failure semantics.
   * @param message - External command diagnostic without command arguments or secrets.
   * @param failure - Evidence selected at the transport boundary.
   * @param cause - Original exception when command execution threw.
   */
  constructor(message: string, failure: ProviderTransportFailure, cause?: unknown) {
    super(message, { cause });
    this.name = PROVIDER_ERROR_NAME.TRANSPORT;
    this.failure = failure;
  }
}

/** Normalize errors consistently, giving response loss precedence over textual status fragments.
 * @param error - Untrusted command diagnostic or tagged transport failure.
 */
export function normalizeProviderFailure(error: unknown): ProviderTransportFailure {
  if (error instanceof ProviderTransportError) return error.failure;
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return { code: PROVIDER_OPERATION_ERROR.UNKNOWN, retryable: false, outcomeUnknown: true };
  }

  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();

  if (/timeout|timed out|etimedout|network|dns|connection reset|econnreset|econnrefused|enotfound|eai_again|socket hang up|lost response/.test(text)) {
    return { code: PROVIDER_OPERATION_ERROR.TRANSIENT, retryable: true, outcomeUnknown: true };
  }

  const match = text.match(PROVIDER_HTTP_STATUS_PATTERN);
  const status = match ? Number(match[1]) : undefined;
  let code: ProviderTransportFailure["code"] = PROVIDER_OPERATION_ERROR.UNKNOWN;

  if (status !== undefined && status >= PROVIDER_HTTP_STATUS.SERVER_ERROR) code = PROVIDER_OPERATION_ERROR.TRANSIENT;
  else if (status === PROVIDER_HTTP_STATUS.RATE_LIMITED || /rate limit/.test(text)) code = PROVIDER_OPERATION_ERROR.RATE_LIMITED;
  else if (status === PROVIDER_HTTP_STATUS.UNAUTHORIZED || /unauthorized|authentication/.test(text)) code = PROVIDER_OPERATION_ERROR.UNAUTHORIZED;
  else if (status === PROVIDER_HTTP_STATUS.FORBIDDEN || /forbidden/.test(text)) code = PROVIDER_OPERATION_ERROR.FORBIDDEN;
  else if (status === PROVIDER_HTTP_STATUS.VALIDATION_FAILED || /validation failed|invalid (?:input|argument|request)/.test(text)) {
    code = PROVIDER_OPERATION_ERROR.VALIDATION_FAILED;
  }
  else if (status === PROVIDER_HTTP_STATUS.CONFLICT || /conflict/.test(text)) code = PROVIDER_OPERATION_ERROR.CONFLICT;
  else if (status === PROVIDER_HTTP_STATUS.NOT_FOUND || /not found|could not resolve to an issue|does not exist/.test(text)) code = PROVIDER_OPERATION_ERROR.NOT_FOUND;

  return { code, status, retryable: code === PROVIDER_OPERATION_ERROR.RATE_LIMITED || code === PROVIDER_OPERATION_ERROR.TRANSIENT,
    outcomeUnknown: code === PROVIDER_OPERATION_ERROR.UNKNOWN || code === PROVIDER_OPERATION_ERROR.TRANSIENT };
}
