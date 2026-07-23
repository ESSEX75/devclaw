/**
 * Heartbeat passes — health, review, review-skip, and test-skip passes.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import type { RunCommand } from "../../context.js";
import { resolveNotifyChannel } from "../../domain/workflow/index.js";
import type { ResolvedConfig } from "../../state/config/types.js";
import { type Project } from "../../state/projects/index.js";
import { getNotificationConfig,notify } from "../notifications/notify.js";
import {
  checkWorkerHealth,
  scanOrphanedLabels,
  scanStatelessIssues,
  type SessionLookup,
} from "./health.js";
import { projectionIntegrityPass } from "./projection.js";
import { reviewPass } from "./review.js";
import { reviewSkipPass } from "./review-skip.js";
import { testSkipPass } from "./test-skip.js";

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/**
 * Run health checks and auto-fix for a project (dev + qa roles).
 */
export async function performHealthPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  sessions: SessionLookup | null,
  provider: import("../../integrations/providers/provider.js").IssueProvider,
  staleWorkerHours?: number,
  instanceName?: string,
  runCommand?: RunCommand,
  stallTimeoutMinutes?: number,
  agentId?: string,
): Promise<number> {
  let fixedCount = 0;

  for (const role of Object.keys(project.workers)) {
    // Check worker health (session liveness, label consistency, etc)
    const healthFixes = await checkWorkerHealth({
      workspaceDir,
      projectSlug,
      project,
      role,
      sessions,
      autoFix: true,
      provider,
      staleWorkerHours,
      stallTimeoutMinutes,
      runCommand: runCommand!,
      agentId,
    });

    fixedCount += healthFixes.filter((f) => f.fixed).length;

    // Scan for orphaned labels (active labels with no tracking worker)
    const orphanFixes = await scanOrphanedLabels({
      workspaceDir,
      projectSlug,
      project,
      role,
      autoFix: true,
      provider,
      instanceName,
    });

    fixedCount += orphanFixes.filter((f) => f.fixed).length;
  }

  // Scan for stateless issues (managed issues that lost their state label — #473)
  const statelessFixes = await scanStatelessIssues({
    workspaceDir,
    projectSlug,
    project,
    provider,
    autoFix: true,
    instanceName,
  });

  fixedCount += statelessFixes.filter((f) => f.fixed).length;

  return fixedCount;
}

/**
 * Run projection integrity checks for initialized DevClaw-managed issues.
 */
export async function performProjectionIntegrityPass(
  workspaceDir: string,
  project: Project,
  provider: import("../../integrations/providers/provider.js").IssueProvider,
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

/**
 * Run review pass for a project — transition issues whose PR check condition is met.
 */
export async function performReviewPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: import("../../integrations/providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime?: PluginRuntime,
  runCommand?: RunCommand,
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
    runCommand: runCommand!,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then((issue) => {
          const target = resolveNotifyChannel(
            issue.labels,
            project.channels,
          );

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
              channel: target?.channel ?? "telegram",
              threadId: target?.threadId,
              runtime,
              accountId: target?.accountId,
              runCommand,
            },
          ).catch(() => {});
        })
        .catch(() => {});
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
          channel: target?.channel ?? "telegram",
          threadId: target?.threadId,
          runtime,
          accountId: target?.accountId,
          runCommand,
        },
      ).catch(() => {});
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
          channel: target?.channel ?? "telegram",
          threadId: target?.threadId,
          runtime,
          accountId: target?.accountId,
          runCommand,
        },
      ).catch(() => {});
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
  provider: import("../../integrations/providers/provider.js").IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime?: PluginRuntime,
  runCommand?: RunCommand,
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
    runCommand: runCommand!,
    onMerge: (issueId, prUrl, prTitle, sourceBranch) => {
      provider
        .getIssue(issueId)
        .then((issue) => {
          const target = resolveNotifyChannel(
            issue.labels,
            project.channels,
          );

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
              channel: target?.channel ?? "telegram",
              threadId: target?.threadId,
              runtime,
              accountId: target?.accountId,
              runCommand,
            },
          ).catch(() => {});
        })
        .catch(() => {});
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
  provider: import("../../integrations/providers/provider.js").IssueProvider,
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
