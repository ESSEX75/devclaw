/** Exposes setup commands, route validation, and scope preflight to adapters. */

export { DEVCLAW_AGENT_TOOLS } from "./const.js";
export { SETUP_NOTIFICATION_CHANNELS } from "./const.js";
export { isSetupNotificationChannel } from "./guards.js";
export {
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "./guards.js";
export { getOnboardingContext } from "./onboarding.js";
export {
  inspectConfiguredProjectRoutes,
  inspectProjectRoute,
  validateDestinationAvailability,
  validateProjectRoute,
} from "./route-validation.js";
export { runSetup } from "./run-setup.js";
export { resolveProjectToolOwners } from "./tool-ownership.js";
export type { SetupNotificationChannel, SetupOpts, SetupResult, SetupRuntime } from "./types.js";
export { compareWorkspaceConfig, resetWorkspaceConfig } from "./workspace-config.js";
