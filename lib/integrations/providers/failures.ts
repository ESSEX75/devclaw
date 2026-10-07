/** Normalizes external failure evidence once for read classification and mutation recovery. */

import { PROVIDER_OPERATION_ERROR } from "./const.js";
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
    this.name = "ProviderTransportError";
    this.failure = failure;
  }
}

/** Normalize errors consistently, giving response loss precedence over textual status fragments.
 * @param error - Untrusted command diagnostic or tagged transport failure.
 */
export function normalizeProviderFailure(error: unknown): ProviderTransportFailure {
  if (error instanceof ProviderTransportError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();

  if (/timeout|timed out|etimedout|network|dns|connection reset|econnreset|econnrefused|enotfound|eai_again|socket hang up|lost response/.test(text)) {
    return { code: PROVIDER_OPERATION_ERROR.TRANSIENT, retryable: true, outcomeUnknown: true };
  }

  const match = text.match(/\b(401|403|404|409|422|429|5\d\d)\b/);
  const status = match ? Number(match[1]) : undefined;
  let code: ProviderTransportFailure["code"] = PROVIDER_OPERATION_ERROR.UNKNOWN;

  if (status !== undefined && status >= 500) code = PROVIDER_OPERATION_ERROR.TRANSIENT;
  else if (status === 429 || /rate limit/.test(text)) code = PROVIDER_OPERATION_ERROR.RATE_LIMITED;
  else if (status === 401 || /unauthorized|authentication/.test(text)) code = PROVIDER_OPERATION_ERROR.UNAUTHORIZED;
  else if (status === 403 || /forbidden/.test(text)) code = PROVIDER_OPERATION_ERROR.FORBIDDEN;
  else if (status === 422 || /validation failed|invalid (?:input|argument|request)/.test(text)) code = PROVIDER_OPERATION_ERROR.VALIDATION_FAILED;
  else if (status === 409 || /conflict/.test(text)) code = PROVIDER_OPERATION_ERROR.CONFLICT;
  else if (status === 404 || /not found|could not resolve to an issue|does not exist/.test(text)) code = PROVIDER_OPERATION_ERROR.NOT_FOUND;

  return { code, status, retryable: code === PROVIDER_OPERATION_ERROR.RATE_LIMITED || code === PROVIDER_OPERATION_ERROR.TRANSIENT,
    outcomeUnknown: code === PROVIDER_OPERATION_ERROR.UNKNOWN || code === PROVIDER_OPERATION_ERROR.TRANSIENT };
}
