/** Exposes notification delivery, routing, and terminal retry operations. */

export { NOTIFICATION_BLOCK_REASON, NOTIFICATION_EVENT, NOTIFICATION_MERGE_ACTOR } from "./const.js";
export { getNotificationConfig, notify } from "./notify.js";
export { recordPipelineNotificationOutcome } from "./record-outcome.js";
export { renderNotificationMessage } from "./render.js";
export { resolveIssueNotificationEndpoint } from "./resolve-endpoint.js";
export { retryPendingPipelineNotifications } from "./retry-pipeline.js";
export type { NotificationConfig, NotificationCreatedTask, NotificationDeliveryResult, NotificationRuntime, NotifyEvent, NotifyOptions } from "./types.js";
