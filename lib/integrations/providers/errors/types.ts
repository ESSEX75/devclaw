/** Owns normalized failure evidence and typed provider operation/lookup error contracts. */

import type { ValueOf } from "../../../types.js";
import type { PROVIDER_ISSUE_LOOKUP_ERROR, PROVIDER_OPERATION_ERROR } from "./const.js";

/** Stable transport category reused by mutation errors. */
export type ProviderOperationErrorCode = ValueOf<typeof PROVIDER_OPERATION_ERROR>;

/** Normalized transport evidence, independent of issue lookup or mutation recovery policy. */
export type ProviderTransportFailure = {
  /** Stable failure category. */
  code: ProviderOperationErrorCode;
  /** Whether a read or explicitly idempotent operation can be repeated. */
  retryable: boolean;
  /** Whether a submitted mutation may already have taken effect. */
  outcomeUnknown: boolean;
  /** Confirmed HTTP status when available. */
  status?: number;
};

/** Read error category derived from the canonical provider registry. */
export type ProviderIssueLookupErrorCode = ValueOf<typeof PROVIDER_ISSUE_LOOKUP_ERROR>;

/** Validated context carried by a provider read failure. */
export type ProviderLookupErrorOptions = {
  /** Classified category; absence requires a separate successful access probe. */
  code: ProviderIssueLookupErrorCode;
  /** Concrete provider owning the failed observation. */
  provider: string;
  /** Whether observation can safely be repeated. */
  retryable: boolean;
  /** Diagnostic describing the failed observation. */
  message: string;
  /** Confirmed HTTP status when supplied by the transport. */
  status?: number;
  /** Original failure retained for inspection. */
  cause?: unknown;
};

/** Mutation evidence retained after one submitted provider operation. */
export type ProviderOperationErrorOptions = {
  /** Stable mutation failure category. */
  code: ProviderOperationErrorCode;
  /** Diagnostic excluding command argument vectors. */
  message: string;
  /** Whether the explicitly replayable operation can be repeated. */
  retryable: boolean;
  /** Whether the submitted mutation may already have taken effect. */
  outcomeUnknown?: boolean;
  /** Provider-supplied retry delay when available. */
  retryAfter?: string;
  /** Original failure retained for inspection. */
  cause?: unknown;
};
