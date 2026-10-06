/** Supported outbound message transport, independent of application notification policy. */

export { MESSAGE_DELIVERY_PATH, MESSAGE_DELIVERY_STATUS } from "./const.js";
export { deliverNotificationMessage } from "./delivery.js";
export type { MessageDeliveryInput, MessageDeliveryOutcome, NotificationChannelRuntime } from "./types.js";
