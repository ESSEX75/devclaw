/** Coordinates review, review-skip, and test-skip policies after maintenance. */

import type { RunCommand } from "../../context.js";
import type { Project } from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import type { ResolvedConfig } from "../../state/index.js";
import { getNotificationConfig, type NotificationRuntime } from "../notifications/index.js";
import { reviewPass } from "./review.js";
import { notifyReviewEvent } from "./review-notification.js";
import { reviewSkipPass } from "./review-skip.js";
import { testSkipPass } from "./test-skip.js";

/**
 * Run review pass for a project — transition issues whose PR check condition is met.
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project identifier.
 * @param project - Project whose queue is inspected.
 * @param provider - Provider PR and issue capabilities.
 * @param resolvedConfig - Resolved workflow, roles, and timeouts.
 * @param pluginConfig - Notification policy settings.
 * @param runtime - Exact native notification route capability.
 * @param runCommand - Provider and gateway command runner.
 */
export async function performReviewPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: NotificationRuntime | undefined,
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
      provider.getIssue(issueId).then(issue => notifyReviewEvent({ workspaceDir, project, issueId,
        event: { type: "prMerged", project: project.name, issueId, issueUrl: issue.web_url, issueTitle: issue.title,
          prUrl: prUrl ?? undefined, prTitle, sourceBranch, targetBranch: project.baseBranch, mergedBy: "heartbeat" },
        config: notifyConfig, runtime, runCommand })).catch(() => {});
    },
    onFeedback: (issueId, reason, prUrl, issueTitle, issueUrl) => {
      notifyReviewEvent({ workspaceDir, project, issueId,
        event: { type: reason === "changes_requested" ? "changesRequested" : "mergeConflict",
          project: project.name, issueId, issueUrl, issueTitle, prUrl: prUrl ?? undefined },
        config: notifyConfig, runtime, runCommand }).catch(() => {});
    },
    onPrClosed: (issueId, prUrl, issueTitle, issueUrl) => {
      notifyReviewEvent({ workspaceDir, project, issueId,
        event: { type: "prClosed", project: project.name, issueId, issueUrl, issueTitle, prUrl: prUrl ?? undefined },
        config: notifyConfig, runtime, runCommand }).catch(() => {});
    },
  });
}

/**
 * Run review skip pass for a project — auto-merge and transition review:skip issues through the review queue.
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project identifier.
 * @param project - Project whose queue is inspected.
 * @param provider - Provider PR and issue capabilities.
 * @param resolvedConfig - Resolved workflow, roles, and timeouts.
 * @param pluginConfig - Notification policy settings.
 * @param runtime - Exact native notification route capability.
 * @param runCommand - Provider and gateway command runner.
 */
export async function performReviewSkipPass(
  workspaceDir: string,
  projectSlug: string,
  project: Project,
  provider: IssueProvider,
  resolvedConfig: ResolvedConfig,
  pluginConfig: Record<string, unknown> | undefined,
  runtime: NotificationRuntime | undefined,
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
      provider.getIssue(issueId).then(issue => notifyReviewEvent({ workspaceDir, project, issueId,
        event: { type: "prMerged", project: project.name, issueId, issueUrl: issue.web_url, issueTitle: issue.title,
          prUrl: prUrl ?? undefined, prTitle, sourceBranch, targetBranch: project.baseBranch, mergedBy: "heartbeat" },
        config: notifyConfig, runtime, runCommand })).catch(() => {});
    },
  });
}

/**
 * Run test skip pass for a project — auto-transition test:skip issues through the test queue.
 * @param workspaceDir - Workspace containing managed issue state.
 * @param projectSlug - Canonical project identifier.
 * @param project - Project whose queue is inspected.
 * @param provider - Provider PR and issue capabilities.
 * @param resolvedConfig - Resolved workflow, roles, and timeouts.
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
