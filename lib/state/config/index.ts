/** Exposes the supported configuration loading, selection, and runtime contracts to the state package. */
export { isConfiguredRoleId } from "./guards.js";
export { loadConfig } from "./loader.js";
export { getConfiguredRoleIds, getLevelMaxWorkers, getResolvedRole } from "./selectors.js";
export type {
  ResolvedConfig,
  ResolvedRoleConfig,
  ResolvedTimeouts,
} from "./types.js";
