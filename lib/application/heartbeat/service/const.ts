/** Stable service identity, configuration key, and timer limits. */

/** Built-in agent when no explicit inventory exists. */
export const HEARTBEAT_AGENT_ID = { MAIN: "main" } as const;

/** Scheduled service identity and startup delay. */
export const HEARTBEAT_SERVICE = { ID: "devclaw-heartbeat", STARTUP_DELAY_MS: 2_000 } as const;

/** OpenClaw plugin setting read by the heartbeat configuration boundary. */
export const HEARTBEAT_CONFIG_KEY = "work_heartbeat";

/** Field names accepted inside the heartbeat plugin setting. */
export const HEARTBEAT_CONFIG_FIELD = {
  ENABLED: "enabled",
  INTERVAL_SECONDS: "intervalSeconds",
  MAX_PICKUPS_PER_TICK: "maxPickupsPerTick",
} as const;

/** Maximum signed 32-bit timer delay accepted by Node without interval rollover. */
export const HEARTBEAT_TIMER_MAX_MS = 2_147_483_647;

/** Milliseconds in one second for validating and scheduling heartbeat timers. */
export const MILLISECONDS_PER_SECOND = 1_000;
