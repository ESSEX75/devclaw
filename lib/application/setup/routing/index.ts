/** Supported setup routing capabilities for coordinating use cases. */

export { ensureChannelBinding, planChannelBinding } from "./binding-manager.js";
export { SETUP_NOTIFICATION_CHANNELS } from "./const.js";
export { isSetupNotificationChannel } from "./guards.js";
export { inspectConfiguredProjectRoutes, inspectProjectRoute, validateDestinationAvailability, validateProjectRoute } from "./route-validation.js";
export type { ProjectRouteInspection,RouteConfig, RouteDiagnostic, SetupNotificationChannel } from "./types.js";
