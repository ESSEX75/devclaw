/** Exposes normalized failure evidence and typed classification shared by adapters and application. */

export { PROVIDER_ISSUE_LOOKUP_ERROR, PROVIDER_OPERATION_ERROR } from "./const.js";
export { normalizeProviderFailure, ProviderTransportError } from "./failures.js";
export { isProviderIssueLookupError, isProviderOperationError } from "./guards.js";
export { classifyProviderLookupFailure, classifyProviderProjectAccessFailure, mayBeMissingProviderIssue, ProviderIssueLookupError } from "./lookup-errors.js";
export { classifyProviderOperationError, ProviderOperationError } from "./operation-errors.js";
export type { ProviderIssueLookupErrorCode, ProviderLookupErrorOptions, ProviderOperationErrorCode, ProviderOperationErrorOptions, ProviderTransportFailure } from "./types.js";
