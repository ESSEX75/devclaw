/** Validates setup channel membership at adapter boundaries. */
import { SETUP_NOTIFICATION_CHANNELS } from "./const.js";
import type { SetupNotificationChannel } from "./types.js";

/** Validate a supported setup channel.
 * @param value - Untrusted adapter input.
 */
export function isSetupNotificationChannel(value: unknown): value is SetupNotificationChannel {
  return SETUP_NOTIFICATION_CHANNELS.some(channel => channel === value);
}
