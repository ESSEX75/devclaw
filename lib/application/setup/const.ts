/** Stable setup identifiers owned by the shared coordinator. */

/** Keep development worker sessions for thirty days. */
export const SUBAGENT_ARCHIVE_AFTER_MINUTES = 30 * 24 * 60;

/** Shared setup operation discriminants. */
export const SETUP_OPERATION = {
  CONFIGURE: "configure",
  EJECT: "eject-defaults",
  RESET: "reset-defaults",
  REFRESH: "refresh-instructions",
} as const;

/** Plugin registration identifier used in the SDK configuration. */
export const DEVCLAW_PLUGIN_ID = "devclaw";

/** Optional memory plugin whose agent allowlist setup extends. */
export const ACTIVE_MEMORY_PLUGIN_ID = "active-memory";

/** SDK reload behavior used during the setup mutation sequence. */
export const CONFIG_RELOAD_MODE = {
  AUTO: "auto",
  NONE: "none",
} as const;

/** Display sentinel for workspace-only setup with no agent target. */
export const UNKNOWN_AGENT_ID = "unknown";
