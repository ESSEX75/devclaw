/** Exposes setup coordination and capability APIs to adapters and sibling use cases. */

export { getOnboardingContext } from "./onboarding/index.js";
export { DEVCLAW_AGENT_TOOLS, isScopeApprovalRejectedError, isScopeApprovalRequiredError, resolveProjectToolOwners } from "./permissions/index.js";
export type { RouteConfig, RouteDiagnostic,SetupNotificationChannel } from "./routing/index.js";
export {
  inspectConfiguredProjectRoutes,
  inspectProjectRoute,
  isSetupNotificationChannel,
  SETUP_NOTIFICATION_CHANNELS,
  validateDestinationAvailability,
  validateProjectRoute,
} from "./routing/index.js";
export { runSetup } from "./run-setup.js";
export type { SetupOpts, SetupResult, SetupRuntime } from "./types.js";
export { compareWorkspaceConfig, resetWorkspaceConfig } from "./workspace-config.js";
