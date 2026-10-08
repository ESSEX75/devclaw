/** Runs independent agents over fresh workspace state and aggregates tick results. */

import type { RunCommand } from "../../../context.js";
import { fetchGatewaySessions } from "../../../integrations/index.js";
import { initializeWorkspaceFiles } from "../../../state/index.js";
import type { NotificationRuntime } from "../../notifications/index.js";
import { tick } from "../tick-runner.js";
import type { HeartbeatTickResult } from "../types.js";
import type { Agent, HeartbeatConfig, ServiceContext } from "./types.js";

/** Process each agent without letting one workspace failure suppress another.
 * @param agents - SDK-resolved agent/workspace pairs.
 * @param config - Global pickup limit for this service tick.
 * @param pluginConfig - Project and notification policy settings.
 * @param logger - Agent-scoped failure diagnostics.
 * @param runCommand - Provider and gateway command capability.
 * @param runtime - Optional native notification transport.
 */
export async function processAllAgents(
  agents: Agent[],
  config: HeartbeatConfig,
  pluginConfig: Record<string, unknown> | undefined,
  logger: ServiceContext["logger"],
  runCommand: RunCommand,
  runtime?: NotificationRuntime,
): Promise<HeartbeatTickResult> {
  const result: HeartbeatTickResult = {
    totalPickups: 0,
    totalHealthFixes: 0,
    totalSkipped: 0,
    totalReviewTransitions: 0,
    totalReviewSkipTransitions: 0,
    totalTestSkipTransitions: 0,
    totalArchived: 0,
    totalCreationsReady: 0,
    totalCreationsPending: 0,
    totalCreationsManual: 0,
    passes: [],
  };

  // A failing workspace cannot suppress maintenance in another agent's workspace.
  const refreshedWorkspaces = new Set<string>();
  const failedWorkspaces = new Set<string>();

  for (const { workspace } of agents) {
    if (refreshedWorkspaces.has(workspace)) continue;
    refreshedWorkspaces.add(workspace);
    try {
      await initializeWorkspaceFiles(workspace);
    } catch (err) {
      failedWorkspaces.add(workspace);
      logger.warn(`Workspace refresh failed for ${workspace}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fetch gateway sessions once for all agents/projects
  const sessions = await fetchGatewaySessions(undefined, runCommand);

  for (const { agentId, workspace } of agents) {
    if (failedWorkspaces.has(workspace)) {
      result.totalSkipped++;
      continue;
    }

    let agentResult: HeartbeatTickResult;

    try {
      agentResult = await tick({
        workspaceDir: workspace,
        agentId,
        config: { ...config, maxPickupsPerTick: Math.max(0, config.maxPickupsPerTick - result.totalPickups) },
        pluginConfig,
        sessions,
        logger,
        runtime,
        runCommand,
      });
    } catch (error) {
      result.totalSkipped++;
      logger.warn(`Heartbeat agent ${agentId} failed in ${workspace}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    result.passes.push(...agentResult.passes);
    result.totalPickups += agentResult.totalPickups;
    result.totalHealthFixes += agentResult.totalHealthFixes;
    result.totalSkipped += agentResult.totalSkipped;
    result.totalReviewTransitions += agentResult.totalReviewTransitions;
    result.totalReviewSkipTransitions += agentResult.totalReviewSkipTransitions;
    result.totalTestSkipTransitions += agentResult.totalTestSkipTransitions;
    result.totalArchived += agentResult.totalArchived;
    result.totalCreationsReady += agentResult.totalCreationsReady;
    result.totalCreationsPending += agentResult.totalCreationsPending;
    result.totalCreationsManual += agentResult.totalCreationsManual;
  }

  return result;
}


/** Log a completed tick only when it changed or attempted maintenance.
 * @param result - Aggregated agent outcomes.
 * @param logger - OpenClaw service logger.
 */
export function logTickResult(
  result: HeartbeatTickResult,
  logger: ServiceContext["logger"],
): void {
  if (
    result.totalPickups > 0 ||
    result.totalHealthFixes > 0 ||
    result.totalReviewTransitions > 0 ||
    result.totalReviewSkipTransitions > 0 ||
    result.totalTestSkipTransitions > 0 ||
    result.totalArchived > 0
    || result.totalCreationsReady > 0
    || result.totalCreationsPending > 0
    || result.totalCreationsManual > 0
  ) {
    logger.info(
      `work_heartbeat tick: ${result.totalPickups} pickups, ${result.totalHealthFixes} health fixes, ` +
      `${result.totalReviewTransitions} review transitions, ${result.totalReviewSkipTransitions} review skips, ` +
      `${result.totalTestSkipTransitions} test skips, ${result.totalSkipped} skipped, ` +
      `${result.totalArchived} archived, ${result.totalCreationsReady} creations ready, ` +
      `${result.totalCreationsPending} creations pending, ${result.totalCreationsManual} creations requiring manual repair`,
    );
  }
}
