/** Resumes creation, projection, terminal effects, and archival in declared order. */

import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/index.js";
import type { ResolvedConfig } from "../../state/index.js";
import { maintainIssueArchive, recoverTerminalIssueArchives } from "../issues/index.js";
import type { NotificationRuntime } from "../notifications/index.js";
import { retryPendingPipelineNotifications } from "../notifications/retry-pipeline.js";
import { recoverTransitionWorkers } from "../pipeline/index.js";
import { reconcileManagedTaskCreations } from "../tasks/index.js";
import { HEARTBEAT_CREATION_LIMIT } from "./const.js";
import { projectionIntegrityPass } from "./projection.js";

/** Verify initialized managed issues against their provider projection.
 * @param workspaceDir - Workspace containing authoritative issue state.
 * @param project - Project whose provider issues are inspected.
 * @param provider - Provider read and label capabilities.
 * @param resolvedConfig - Workflow and configured role identities.
 */
export async function performProjectionIntegrityPass(
  workspaceDir: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
): Promise<number> {
  const result = await projectionIntegrityPass({
    workspaceDir,
    project,
    provider,
    workflow: resolvedConfig.workflow,
    roles: Object.keys(resolvedConfig.roles),
  });

  return result.repaired + result.removed + result.errors;
}

/** Resume a bounded batch of durable creation operations before lifecycle passes run.
 * @param workspaceDir - Workspace containing creation intents.
 * @param project - Project owning creation operations.
 * @param provider - Provider read and creation capabilities.
 * @param resolvedConfig - Workflow and role configuration.
 */
export async function performIssueCreationPass(
  workspaceDir: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
): Promise<{ ready: number; pending: number; manual: number }> {
  const result = await reconcileManagedTaskCreations({
    workspaceDir,
    project,
    providerType: project.provider,
    provider,
    workflow: resolvedConfig.workflow,
    roles: Object.keys(resolvedConfig.roles),
    maxItems: HEARTBEAT_CREATION_LIMIT,
  });

  return { ready: result.ready.length, pending: result.pending.length, manual: result.manual.length };
}

/**
 * Retry durable terminal notifications, archive eligible terminal issues, and apply retention maintenance.
 *
 * @param workspaceDir - Workspace containing project-local issue and archive state.
 * @param project - Project whose terminal issues are processed.
 * @param provider - Provider used to rebuild retry notification context.
 * @param resolvedConfig - Project configuration controlling archive maintenance limits.
 * @param pluginConfig - Plugin notification toggles applied to retry delivery.
 * @param runtime - OpenClaw runtime used for routed notification delivery.
 * @param runCommand - Command runner available as the notification fallback path.
 */
export async function performIssueArchivePass(
  workspaceDir: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: NotificationRuntime | undefined,
  runCommand: RunCommand,
): Promise<number> {
  await recoverTransitionWorkers(workspaceDir, project.slug, resolvedConfig.issueArchiveMaintenance.maxPerHeartbeat);
  await retryPendingPipelineNotifications(
    workspaceDir,
    project,
    provider,
    pluginConfig,
    runtime,
    runCommand,
    resolvedConfig.issueArchiveMaintenance.maxPerHeartbeat,
  );
  const result = await recoverTerminalIssueArchives({
    workspaceDir,
    projectSlug: project.slug,
    workflow: resolvedConfig.workflow,
    maxItems: resolvedConfig.issueArchiveMaintenance.maxPerHeartbeat,
  });

  const remaining = Math.max(0, resolvedConfig.issueArchiveMaintenance.maxPerHeartbeat - result.archived.length);

  if (remaining > 0) {
    await maintainIssueArchive({
      workspaceDir,
      projectSlug: project.slug,
      archiveRetention: resolvedConfig.issueArchiveMaintenance.archiveRetention,
      deletedProviderRetention: resolvedConfig.issueArchiveMaintenance.deletedProviderRetention,
      attachmentsRetention: resolvedConfig.issueArchiveMaintenance.attachmentsRetention,
      maxItems: remaining,
    });
  }

  return result.archived.length;
}
