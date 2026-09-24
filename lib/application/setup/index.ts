/** Exposes setup commands, route validation, and scope preflight to adapters. */
export { createAgent, getAgentId, getAgentWorkspacePath, resolveWorkspacePath } from "./agent-config.js";
export { ensureChannelBinding } from "./binding-manager.js";
export { buildOnboardToolContext, buildReconfigContext, hasWorkspaceFiles, isPluginConfigured } from "./onboarding.js";
export { DEVCLAW_AGENT_TOOLS, writePluginConfig } from "./plugin-config.js";
export {
  inspectConfiguredProjectRoutes,
  inspectProjectRoute,
  validateDestinationAvailability,
  validateProjectRoute,
} from "./route-validation.js";
export type { SetupNotificationChannel, SetupOpts } from "./run-setup.js";
export { isSetupNotificationChannel, runSetup, SETUP_NOTIFICATION_CHANNELS } from "./run-setup.js";
export {
  ensureRequiredOpenClawScopes,
  isScopeApprovalRejectedError,
  isScopeApprovalRequiredError,
} from "./scopes.js";
