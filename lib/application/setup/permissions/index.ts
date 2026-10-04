/** Supported setup permissions capabilities for coordinating use cases. */

export { DEVCLAW_AGENT_TOOLS } from "./const.js";
export { isScopeApprovalRejectedError, isScopeApprovalRequiredError } from "./guards.js";
export { ensureRequiredOpenClawScopes } from "./scopes.js";
export { resolveProjectToolOwners } from "./tool-ownership.js";
export { buildAgentToolPolicy } from "./tool-policy.js";
export type { ScopePreflightResult } from "./types.js";
