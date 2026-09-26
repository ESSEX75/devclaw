/** Validates setup channel membership at adapter boundaries. */
import { SETUP_NOTIFICATION_CHANNELS } from "./const.js";
import { ScopeApprovalRejectedError,ScopeApprovalRequiredError } from "./errors.js";
import type { SetupNotificationChannel } from "./types.js";

/** Validate a supported setup channel.
 * @param value - Untrusted adapter input.
 */
export function isSetupNotificationChannel(value: unknown): value is SetupNotificationChannel {
  return SETUP_NOTIFICATION_CHANNELS.some(channel => channel === value);
}

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
