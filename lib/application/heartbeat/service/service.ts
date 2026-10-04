/** Registers one heartbeat timer lifecycle and serializes scheduled ticks. */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import type { PluginContext } from "../../../context.js";
import { discoverAgents } from "./agent-discovery.js";
import { logTickResult, processAllAgents } from "./agent-runner.js";
import { resolveHeartbeatConfig } from "./config.js";
import { HEARTBEAT_SERVICE, MILLISECONDS_PER_SECOND } from "./const.js";
import type { HeartbeatLifecycle, HeartbeatServiceDependencies, ServiceContext } from "./types.js";

/** Create an isolated timer lifecycle with one in-flight tick at most.
 * @param pluginCtx - Plugin configuration, gateway command, and runtime capabilities.
 * @param runTick - Optional supplied tick for lifecycle integration tests.
 */
export function createHeartbeatLifecycle(pluginCtx: HeartbeatServiceDependencies, runTick?: () => Promise<void>): HeartbeatLifecycle {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let startupTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let warnedNoAgents = false;
  let generation = 0;

  const clearTimers = (): void => {
    if (intervalId) clearInterval(intervalId);
    if (startupTimeoutId) clearTimeout(startupTimeoutId);
    intervalId = null;
    startupTimeoutId = null;
  };

  return {
    start: async (svcCtx: ServiceContext) => {
      const currentGeneration = ++generation;

      clearTimers();
      if (inFlight) await inFlight;
      if (generation !== currentGeneration) return;
      const heartbeatConfig = resolveHeartbeatConfig(pluginCtx.pluginConfig);

      if (!heartbeatConfig.enabled) {
        svcCtx.logger.info("work_heartbeat service disabled");

        return;
      }

      const run = (): void => {
        if (inFlight || generation !== currentGeneration) return;
        const running = (async () => {
          try {
            if (runTick) {
              await runTick();

              return;
            }

            const config = resolveHeartbeatConfig(pluginCtx.pluginConfig);

            if (!config.enabled || generation !== currentGeneration) return;
            const discovery = await discoverAgents(svcCtx.config ?? pluginCtx.config);

            for (const error of discovery.errors) svcCtx.logger.warn(error);
            if (discovery.agents.length === 0) {
              if (!warnedNoAgents) svcCtx.logger.warn("work_heartbeat tick skipped: no DevClaw project workspaces discovered");
              warnedNoAgents = true;

              return;
            }

            warnedNoAgents = false;
            if (generation !== currentGeneration) return;
            const result = await processAllAgents(discovery.agents, config, pluginCtx.pluginConfig,
              svcCtx.logger, pluginCtx.runCommand, pluginCtx.runtime);

            logTickResult(result, svcCtx.logger);
          } catch (error) {
            svcCtx.logger.error(`work_heartbeat tick failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();

        inFlight = running;
        running.finally(() => { if (inFlight === running) inFlight = null; }).catch(() => {});
      };

      intervalId = setInterval(run, heartbeatConfig.intervalSeconds * MILLISECONDS_PER_SECOND);
      intervalId.unref?.();
      startupTimeoutId = setTimeout(run, HEARTBEAT_SERVICE.STARTUP_DELAY_MS);
      startupTimeoutId.unref?.();
      svcCtx.logger.info(`work_heartbeat service started: interval=${heartbeatConfig.intervalSeconds}s maxPickupsPerTick=${heartbeatConfig.maxPickupsPerTick}`);
    },
    stop: async (svcCtx: ServiceContext) => {
      generation++;
      clearTimers();
      if (inFlight) await inFlight;
      svcCtx.logger.info("work_heartbeat service stopped");
    },
  };
}

/** Register the supported heartbeat service with OpenClaw.
 * @param api - Plugin registration boundary.
 * @param pluginCtx - Plugin configuration, transport, and command capabilities.
 */
export function registerHeartbeatService(api: OpenClawPluginApi, pluginCtx: PluginContext): void {
  api.registerService({ id: HEARTBEAT_SERVICE.ID, ...createHeartbeatLifecycle(pluginCtx) });
}
