import { NOTIFICATION_CHANNEL } from "./const.js";
import type { NotificationChannel } from "./types.js";

/** Check whether an unknown value is a supported notification channel. */
export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string"
    && Object.values(NOTIFICATION_CHANNEL).some((channel) => channel === value);
}
