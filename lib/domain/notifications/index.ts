/** Exposes the supported notification-domain API to sibling packages and external consumers. */
export { NOTIFICATION_CHANNEL, NOTIFY_LABEL_COLOR, NOTIFY_LABEL_PREFIX } from "./const.js";
export { isNotificationChannel } from "./guards.js";
export { getNotifyLabel, resolveNotifyBinding } from "./routing.js";
export type { NotificationChannel, NotificationEndpoint, NotifyBindingRef } from "./types.js";
