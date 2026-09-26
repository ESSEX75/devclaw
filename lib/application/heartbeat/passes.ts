/**
 * Heartbeat passes — health, review, review-skip, and test-skip passes.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import { NOTIFICATION_CHANNEL } from "../../domain/index.js";
import { type Project } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import type { ResolvedConfig } from "../../state/index.js";
import { getConfiguredRoleIds } from "../../state/index.js";
import { maintainIssueArchive, recoverTerminalIssueArchives } from "../issues/index.js";
import { getNotificationConfig, notify } from "../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../notifications/resolve-endpoint.js";
import { retryPendingPipelineNotifications } from "../notifications/retry-pipeline.js";
import { reconcileManagedTaskCreations } from "../tasks/index.js";
import {
  checkWorkerHealth,
  type HealthFix,
  scanOrphanedLabels,
  scanStatelessIssues,
} from "./health.js";
import { projectionIntegrityPass } from "./projection.js";
import { reviewPass } from "./review.js";
import { reviewSkipPass } from "./review-skip.js";
import { testSkipPass } from "./test-skip.js";
import type { HealthPassInput } from "./types.js";

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/** Inspect all health categories, applying remedies only when explicitly requested.
 * @param input - Project dependencies and explicit diagnosis/remediation mode.
 */
export async function performHealthPass(input: HealthPassInput): Promise<HealthFix[]> {
  const { workspaceDir, projectSlug, project, sessions, provider, resolvedConfig, staleWorkerHours,
    instanceName, runCommand, stallTimeoutMinutes, agentId, autoFix } = input;
  const findings: HealthFix[] = [];
  const collect = async (role: string, run: () => Promise<HealthFix[]>): Promise<void> => {
    try { findings.push(...await run()); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      findings.push({ issue: { type: "inspection_failed", severity: "critical", project: project.name, projectSlug, role, message }, fixed: false, error: message });
    }
  };

  for (const role of getConfiguredRoleIds(resolvedConfig)) {
    // Check worker health (session liveness, label consistency, etc)
    await collect(role, () => checkWorkerHealth({
      workspaceDir,
      projectSlug,
      project,
      role,
      sessions,
      autoFix,
      provider,
      workflow: resolvedConfig.workflow,
      staleWorkerHours,
      stallTimeoutMinutes,
      runCommand,
      agentId,
    }));

    // Scan for orphaned labels (active labels with no tracking worker)
    await collect(role, () => scanOrphanedLabels({
      workspaceDir,
      projectSlug,
      project,
      role,
      autoFix,
      provider,
      workflow: resolvedConfig.workflow,
      instanceName,
    }));
  }

  // Scan for stateless issues (managed issues that lost their state label — #473)
  await collect("", () => scanStatelessIssues({
    workspaceDir,
    projectSlug,
    project,
    provider,
    workflow: resolvedConfig.workflow,
    autoFix,
    instanceName,
  }));

  return findings;
}

/**
 * Run projection integrity checks for initialized DevClaw-managed issues.
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

/** Resume a bounded batch of durable issue creation operations before lifecycle passes run. */
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
    maxItems: 20,
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
  runtime: PluginRuntime | undefined,
  runCommand: RunCommand,
): Promise<number> {
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

/**
 * Run review pass for a project — transition issues whose PR check condition is met.
 */
export async function performReviewPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: PluginRuntime | undefined,
  runCommand: RunCommand,
): Promise<number> {
  const notifyConfig = getNotificationConfig(pluginConfig);

  return reviewPass({
    workspaceDir,
    projectName: projectSlug,
    project,
    workflow: resolvedConfig.workflow,
    provider,
    repoPath: project.repo,
    gitPullTimeoutMs: resolvedConfig.timeouts.gitPullMs,
    baseBranch: project.baseBranch,
    runCommand,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then(async (issue) => {
          const target = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);

          notify(
            {
              type: "prMerged",
              project: project.name,
              issueId,
              issueUrl: issue.web_url,
              issueTitle: issue.title,
              prUrl: prUrl ?? undefined,
              prTitle,
              sourceBranch,
              targetBranch: project.baseBranch,
              mergedBy: "heartbeat",
            },
            {
              workspaceDir,
              config: notifyConfig,
              channelId: target?.channelId,
              channel: target?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
              threadId: target?.threadId,
              runtime,
              accountId: target?.accountId,
              agentId: project.agentId,
              runCommand,
            },
          ).catch(() => { });
        })
        .catch(() => { });
    },
    onFeedback: (issueId, reason, prUrl, issueTitle, issueUrl) => {
      const type =
        reason === "changes_requested"
          ? ("changesRequested" as const)
          : ("mergeConflict" as const);
      // No issue labels available in this callback — fall back to primary channel
      const target = project.channels[0];

      notify(
        {
          type,
          project: project.name,
          issueId,
          issueUrl,
          issueTitle,
          prUrl: prUrl ?? undefined,
        },
        {
          workspaceDir,
          config: notifyConfig,
          channelId: target?.channelId,
          channel: target?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
          threadId: target?.threadId,
          runtime,
          accountId: target?.accountId,
          agentId: project.agentId,
          runCommand,
        },
      ).catch(() => { });
    },
    onPrClosed: (issueId, prUrl, issueTitle, issueUrl) => {
      // No issue labels available in this callback — fall back to primary channel
      const target = project.channels[0];

      notify(
        {
          type: "prClosed",
          project: project.name,
          issueId,
          issueUrl,
          issueTitle,
          prUrl: prUrl ?? undefined,
        },
        {
          workspaceDir,
          config: notifyConfig,
          channelId: target?.channelId,
          channel: target?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
          threadId: target?.threadId,
          runtime,
          accountId: target?.accountId,
          agentId: project.agentId,
          runCommand,
        },
      ).catch(() => { });
    },
  });
}

/**
 * Run review skip pass for a project — auto-merge and transition review:skip issues through the review queue.
 */
export async function performReviewSkipPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: PluginRuntime | undefined,
  runCommand: RunCommand,
): Promise<number> {
  const notifyConfig = getNotificationConfig(pluginConfig);

  return reviewSkipPass({
    workspaceDir,
    projectName: projectSlug,
    project,
    workflow: resolvedConfig.workflow,
    provider,
    repoPath: project.repo,
    gitPullTimeoutMs: resolvedConfig.timeouts.gitPullMs,
    runCommand,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then(async (issue) => {
          const target = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);

          notify(
            {
              type: "prMerged",
              project: project.name,
              issueId,
              issueUrl: issue.web_url,
              issueTitle: issue.title,
              prUrl: prUrl ?? undefined,
              prTitle,
              sourceBranch,
              targetBranch: project.baseBranch,
              mergedBy: "heartbeat",
            },
            {
              workspaceDir,
              config: notifyConfig,
              channelId: target?.channelId,
              channel: target?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
              threadId: target?.threadId,
              runtime,
              accountId: target?.accountId,
              agentId: project.agentId,
              runCommand,
            },
          ).catch(() => { });
        })
        .catch(() => { });
    },
  });
}

/**
 * Run test skip pass for a project — auto-transition test:skip issues through the test queue.
 */
export async function performTestSkipPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
): Promise<number> {
  return testSkipPass({
    workspaceDir,
    projectName: projectSlug,
    project,
    workflow: resolvedConfig.workflow,
    provider,
  });
}
