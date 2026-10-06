/** Identifies typed gateway approval failures without parsing messages. */

import { ScopeApprovalRejectedError, ScopeApprovalRequiredError } from "./errors.js";

/** Identify a pending approval without inspecting error message text.
 * @param err - Unknown failure from setup.
 */
export function isScopeApprovalRequiredError(err: unknown): err is ScopeApprovalRequiredError {
  return err instanceof ScopeApprovalRequiredError;
}

/** Identify an explicit gateway refusal or expiry.
 * @param err - Unknown failure from setup.
 */
export function isScopeApprovalRejectedError(err: unknown): err is ScopeApprovalRejectedError {
  return err instanceof ScopeApprovalRejectedError;
}
