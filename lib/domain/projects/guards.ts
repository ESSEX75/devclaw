import type { NotificationChannel } from "../shared/types.js";
import { NOTIFICATION_CHANNEL } from "./const.js";

/** Check whether an unknown value is a supported notification channel identifier. */
export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === "string"
    && Object.values(NOTIFICATION_CHANNEL).some((channel) => channel === value);
}
