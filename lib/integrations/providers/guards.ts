/** Narrows classified provider failures without parsing external diagnostics or selecting recovery policy. */

import { ProviderIssueLookupError } from "./lookup-errors.js";
import { ProviderOperationError } from "./operation-errors.js";

/** Identify a provider-owned read failure whose classification must remain intact.
 * @param error - Unknown failure caught by an adapter or application use case.
 */
export function isProviderIssueLookupError(error: unknown): error is ProviderIssueLookupError {
  return error instanceof ProviderIssueLookupError;
}

/** Identify mutation evidence already classified at the provider boundary.
 * @param error - Unknown failure caught after a provider operation.
 */
export function isProviderOperationError(error: unknown): error is ProviderOperationError {
  return error instanceof ProviderOperationError;
}
