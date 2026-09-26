/**
 * Tick runner — main heartbeat loop that processes each project.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import { EXECUTION_MODE } from "../../domain/index.js";
import { loadInstanceName } from "../../instance.js";
import { createProvider } from "../../integrations/providers/index.js";
import { loadConfig } from "../../state/index.js";
import { getProject, readProjects } from "../../state/index.js";
import { projectTick } from "../queue/tick.js";
import type { HeartbeatConfig } from "./config.js";
import { HEARTBEAT_PASS } from "./const.js";
import {
  type SessionLookup,
} from "./health.js";
import { runHeartbeatPasses } from "./pass-runner.js";
import {
  performHealthPass,
  performIssueArchivePass,
  performIssueCreationPass,
  performProjectionIntegrityPass,
  performReviewPass,
  performReviewSkipPass,
  performTestSkipPass,
} from "./passes.js";
import type { HeartbeatTickResult } from "./types.js";

// ---------------------------------------------------------------------------
// Tick (Main Heartbeat Loop)
// ---------------------------------------------------------------------------

/** Coordinate ordered project maintenance and queue scheduling with project failure isolation.
 * @param opts - Workspace, gateway observations, scheduling limits, and runtime capabilities.
 */
export async function tick(opts: {
  workspaceDir: string;
  agentId?: string;
  config: HeartbeatConfig;
  pluginConfig?: Record<string, unknown>;
  sessions: SessionLookup | null;
  logger: { info(msg: string): void; warn(msg: string): void };
  runtime?: PluginRuntime;
  runCommand: RunCommand;
}): Promise<HeartbeatTickResult> {
  const { workspaceDir, agentId, config, pluginConfig, sessions, runtime, runCommand } = opts;

  // Load instance name for ownership filtering and auto-claiming
  const resolvedWorkspaceConfig = await loadConfig(workspaceDir);
  const instanceName = await loadInstanceName(workspaceDir, resolvedWorkspaceConfig.instanceName);

  const data = await readProjects(workspaceDir);
  const slugs = Object.keys(data.projects);

  if (slugs.length === 0) {
    return {
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
  }

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

  const projectExecution =
    pluginConfig?.projectExecution === EXECUTION_MODE.SEQUENTIAL ? EXECUTION_MODE.SEQUENTIAL : EXECUTION_MODE.PARALLEL;
  let activeProjects = 0;

  for (const slug of slugs) {
    try {
      const project = data.projects[slug];

      if (!project) continue;

      const resolvedConfig = await loadConfig(workspaceDir, project.slug);
      const { provider } = await createProvider({
        repo: project.repo,
        provider: project.provider,
        runCommand,
        workflow: resolvedConfig.workflow,
      });

      const completed = await runHeartbeatPasses(slug, [
        { name: HEARTBEAT_PASS.CREATION, run: async () => {
          const creations = await performIssueCreationPass(workspaceDir, project, provider, resolvedConfig);

          result.totalCreationsReady += creations.ready;
          result.totalCreationsPending += creations.pending;
          result.totalCreationsManual += creations.manual;
        } },
        { name: HEARTBEAT_PASS.PROJECTION, run: async () => {
          await performProjectionIntegrityPass(workspaceDir, project, provider, resolvedConfig);
        } },
        { name: HEARTBEAT_PASS.ARCHIVE, run: async () => {
          result.totalArchived += await performIssueArchivePass(workspaceDir, project, provider, resolvedConfig, pluginConfig, runtime, runCommand);
        } },
        { name: HEARTBEAT_PASS.HEALTH, run: async () => {
          const fixes = await performHealthPass({
            workspaceDir, projectSlug: slug, project, sessions, provider, resolvedConfig,
            staleWorkerHours: resolvedConfig.timeouts.staleWorkerHours, instanceName, runCommand,
            stallTimeoutMinutes: resolvedConfig.timeouts.stallTimeoutMinutes, agentId, autoFix: true,
          });

          result.totalHealthFixes += fixes.filter((fix) => fix.fixed).length;

          return fixes;
        } },
        { name: HEARTBEAT_PASS.REVIEW, run: async () => {
          result.totalReviewTransitions += await performReviewPass(workspaceDir, slug, project, provider, resolvedConfig, pluginConfig, runtime, runCommand);
        } },
        { name: HEARTBEAT_PASS.REVIEW_SKIP, run: async () => {
          result.totalReviewSkipTransitions += await performReviewSkipPass(workspaceDir, slug, project, provider, resolvedConfig, pluginConfig, runtime, runCommand);
        } },
        { name: HEARTBEAT_PASS.TEST_SKIP, run: async () => {
          result.totalTestSkipTransitions += await performTestSkipPass(workspaceDir, slug, project, provider, resolvedConfig);
        } },
      ], result.passes);

      if (!completed) {
        opts.logger.warn(`Heartbeat pass failed for project ${slug}: ${result.passes.at(-1)?.errors.join("; ")}`);
        result.totalSkipped++;
        continue;
      }

      // Budget check: stop if we've hit the limit
      const remaining = config.maxPickupsPerTick - result.totalPickups;

      if (remaining <= 0) break;

      // Sequential project guard: don't start new projects if one is active
      const isProjectActive = await checkProjectActive(workspaceDir, slug);

      if (
        projectExecution === EXECUTION_MODE.SEQUENTIAL &&
        !isProjectActive &&
        activeProjects >= 1
      ) {
        result.totalSkipped++;
        continue;
      }

      // Tick pass: fill free worker slots
      const tickResult = await projectTick({
        workspaceDir,
        projectSlug: slug,
        agentId,
        pluginConfig,
        maxPickups: remaining,
        instanceName,
        runtime,
        runCommand,
      });

      result.totalPickups += tickResult.pickups.length;
      result.totalSkipped += tickResult.skipped.length;

      // Notifications now handled by dispatchTask
      if (isProjectActive || tickResult.pickups.length > 0) activeProjects++;
    } catch (err) {
      // Per-project isolation: one failing project doesn't crash the entire tick
      opts.logger.warn(
        `Heartbeat tick failed for project ${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      result.totalSkipped++;
    }
  }

  await auditLog(workspaceDir, "heartbeat_tick", {
    projectsScanned: slugs.length,
    healthFixes: result.totalHealthFixes,
    reviewTransitions: result.totalReviewTransitions,
    reviewSkipTransitions: result.totalReviewSkipTransitions,
    testSkipTransitions: result.totalTestSkipTransitions,
    archived: result.totalArchived,
    pickups: result.totalPickups,
    skipped: result.totalSkipped,
  });

  return result;
}

/**
 * Check if a project has any active worker.
 */
export async function checkProjectActive(
  workspaceDir: string,
  slug: string,
): Promise<boolean> {
  const data = await readProjects(workspaceDir);
  const project = getProject(data, slug);

  if (!project) return false;

  return Object.values(project.workers).some((w) =>
    Object.values(w.levels).some(slots => slots?.some(s => s.active) ?? false),
  );
}
