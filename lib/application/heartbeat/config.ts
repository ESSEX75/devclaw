/** Parses heartbeat service settings using validated fields and stable defaults. */

import { HEARTBEAT_CONFIG_KEY, HEARTBEAT_TIMER_MAX_MS } from "./const.js";
import { HEARTBEAT_DEFAULTS } from "./defaults.js";
import type { HeartbeatConfig } from "./types.js";

/** Resolve only valid configured values; malformed inputs retain safe defaults.
 * @param pluginConfig - Untrusted plugin settings at the application boundary.
 */
export function resolveHeartbeatConfig(pluginConfig?: Record<string, unknown>): HeartbeatConfig {
  const raw = pluginConfig?.[HEARTBEAT_CONFIG_KEY];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...HEARTBEAT_DEFAULTS };
  const enabled = Reflect.get(raw, "enabled");
  const interval = Reflect.get(raw, "intervalSeconds");
  const pickups = Reflect.get(raw, "maxPickupsPerTick");

  return {
    enabled: typeof enabled === "boolean" ? enabled : HEARTBEAT_DEFAULTS.enabled,
    intervalSeconds: Number.isSafeInteger(interval) && interval > 0 && interval * 1_000 <= HEARTBEAT_TIMER_MAX_MS
      ? interval : HEARTBEAT_DEFAULTS.intervalSeconds,
    maxPickupsPerTick: Number.isSafeInteger(pickups) && pickups >= 0 ? pickups : HEARTBEAT_DEFAULTS.maxPickupsPerTick,
  };
}
