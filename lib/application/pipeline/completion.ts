/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import { log as auditLog } from "../../audit.js";
import type { RunCommand } from "../../context.js";
import {
  ACTION,
  COMPLETION_RESULT,
  type CompletionEventMap,
  type CompletionRule,
  DEFAULT_WORKFLOW,
  findStateByLabel,
  getCompletionEmoji,
  getCompletionRule,
  ISSUE_ARCHIVE_REASON,
  NOTIFICATION_CHANNEL,
  type NotificationEndpoint,
  STATE_TYPE,
  type WorkflowConfig,
} from "../../domain/index.js";
import type { IssueProvider } from "../../integrations/providers/provider.js";
import { loadConfig } from "../../state/index.js";
import {
  confirmPipelineNotification,
  readIssueStateStore,
  reservePipelineNotification,
  withIssueOrchestrationLock,
} from "../../state/index.js";
import { deactivateWorker, getProject, getRoleWorker, readProjects } from "../../state/index.js";
import { archiveManagedIssueLocked } from "../issues/index.js";
import {
  getNotificationConfig,
  type NotificationRuntime,
  notify,
} from "../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../notifications/resolve-endpoint.js";
import { planCompletion, planMergeFailure } from "./plan.js";
import { commitWorkflowTransitionLocked } from "./transition.js";
import type { CompletionOutput } from "./types.js";

export type { CompletionRule };

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  completion: CompletionEventMap,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule<string> | undefined {
  const event = completion[result];

  return event
    ? getCompletionRule(workflow, role, event) ?? undefined
    : undefined;
}

/**
 * Execute the completion side-effects for a role:result pair.
 * @param opts - Resolved worker completion request and runtime dependencies.
 */
export async function executeCompletion(opts: {
  workspaceDir: string;
  projectSlug: string;
  role: string;
  result: string;
  issueId: number;
  summary?: string;
  prUrl?: string;
  provider: IssueProvider;
  repoPath: string;
  projectName: string;
  channels: NotificationEndpoint[];
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: NotificationRuntime;
  /** Workflow config (defaults to DEFAULT_WORKFLOW) */
  workflow?: WorkflowConfig;
  /** Tasks created during this work session (e.g. architect implementation tasks) */
  createdTasks?: Array<{ id: number; title: string; url: string }>;
  /** Level of the completing worker */
  level?: string;
  /** Slot index within the level's array */
  slotIndex?: number;
  runCommand: RunCommand;
}): Promise<CompletionOutput> {
  return withIssueOrchestrationLock(
    opts.workspaceDir,
    opts.projectSlug,
    opts.issueId,
    () => executeCompletionLocked(opts),
  );
}

/** Plan, execute, commit, release, and notify while holding the issue lock.
 * @param opts - Worker completion request whose source state must still be current.
 */
async function executeCompletionLocked(opts: {
  workspaceDir: string;
  projectSlug: string;
  role: string;
  result: string;
  issueId: number;
  summary?: string;
  prUrl?: string;
  provider: IssueProvider;
  repoPath: string;
  projectName: string;
  channels: NotificationEndpoint[];
  pluginConfig?: Record<string, unknown>;
  runtime?: NotificationRuntime;
  workflow?: WorkflowConfig;
  createdTasks?: Array<{ id: number; title: string; url: string }>;
  level?: string;
  slotIndex?: number;
  runCommand: RunCommand;
}): Promise<CompletionOutput> {
  const rc = opts.runCommand;
  const {
    workspaceDir, projectSlug, role, result, issueId, summary, provider,
    repoPath, projectName, pluginConfig, runtime,
    workflow = DEFAULT_WORKFLOW,
    createdTasks,
  } = opts;

  const key = `${role}:${result}`;
  const config = await loadConfig(workspaceDir, projectSlug);
  const completion = config.roles[role]?.completion;

  if (!completion) throw new Error(`No completion event configured for ${key}`);
  const completionPlan = planCompletion(workflow, role, result, completion);
  const { rule } = completionPlan;

  const { timeouts } = config;
  const project = getProject(await readProjects(workspaceDir), projectSlug);

  if (!project) {
    throw new Error(`Project "${projectSlug}" not found.`);
  }

  const currentState = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];

  if (currentState && currentState.workflowLabel !== rule.from) {
    throw new Error(`Completion for #${issueId} expected ${rule.from}, found ${currentState.workflowLabel}.`);
  }

  const currentIssue = await provider.getIssue(issueId);

  if (!currentIssue.labels.includes(rule.from)) {
    throw new Error(`Completion for #${issueId} expected provider label ${rule.from}.`);
  }

  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;
  let mergeFailure: { error: string } | null = null;

  // Execute pre-notification actions
  for (const action of rule.actions) {
    switch (action) {
      case ACTION.GIT_PULL:
        try { await rc(["git", "pull"], { timeoutMs: timeouts.gitPullMs, cwd: repoPath }); } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "gitPull", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => { });
        }

        break;
      case ACTION.DETECT_PR:
        if (!prUrl) {
          try {
            // Try open PR first (developer just finished — MR is still open), fall back to merged
            const prStatus = await provider.getPrStatus(issueId);

            prUrl = prStatus.url ?? await provider.getMergedMRUrl(issueId) ?? undefined;
            prTitle = prStatus.title;
            sourceBranch = prStatus.sourceBranch;
          } catch (err) {
            auditLog(workspaceDir, "pipeline_warning", { step: "detectPr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => { });
          }
        }

        break;
      case ACTION.MERGE_PR:
        try {
          // Grab PR metadata before merging (the MR is still open at this point)
          if (!prTitle) {
            try {
              const prStatus = await provider.getPrStatus(issueId);

              prUrl = prUrl ?? prStatus.url ?? undefined;
              prTitle = prStatus.title;
              sourceBranch = prStatus.sourceBranch;
            } catch { /* best-effort */ }
          }

          await provider.mergePr(issueId);
          mergedPr = true;
        } catch (err) {
          const error = (err as Error).message ?? String(err);

          await auditLog(workspaceDir, "pipeline_action_failed", {
            step: "mergePr",
            issue: issueId,
            role,
            error,
            from: rule.from,
            attemptedTo: rule.to,
          });
          mergeFailure = { error };
        }

        break;
    }

    if (mergeFailure) break;
  }

  // Get issue early (for URL in notification + channel routing)
  const issue = await provider.getIssue(issueId);
  const notifyTarget = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId);

  if (mergeFailure) {
    const failedTransition = planMergeFailure(workflow, rule.from);

    if (!failedTransition) {
      throw new Error(`mergePr failed for #${issueId}, and workflow has no MERGE_FAILED recovery transition: ${mergeFailure.error}`);
    }

    await commitWorkflowTransitionLocked({
      workspaceDir,
      project,
      issueId,
      provider,
      issue,
      workflow,
      plan: failedTransition,
      roles: Object.keys(config.roles),
      owner: "pipeline_merge_failure",
    });

    await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId });

    await auditLog(workspaceDir, "pipeline_transition", {
      project: projectName,
      issue: issueId,
      role,
      from: rule.from,
      to: failedTransition.toLabel,
      reason: "merge_failed",
      error: mergeFailure.error,
    });

    return {
      labelTransition: `${rule.from} → ${failedTransition.toLabel}`,
      announcement: `⚠️ MERGE FAILED #${issueId} — ${mergeFailure.error}\n📋 [Issue #${issueId}](${issue.web_url})\n→ ${failedTransition.toLabel}.`,
      nextState: failedTransition.toLabel,
      prUrl,
      issueUrl: issue.web_url,
      issueClosed: false,
      issueReopened: false,
    };
  }

  // Get next state description from workflow
  const nextState = completionPlan.nextState;

  // Retrieve worker name from project state (best-effort)
  let workerName: string | undefined;
  let targetBranch: string | undefined;

  try {
    targetBranch = project.baseBranch;
    if (opts.level !== undefined && opts.slotIndex !== undefined) {
      const roleWorker = getRoleWorker(project, role);
      const slot = roleWorker.levels[opts.level]?.[opts.slotIndex];

      workerName = slot?.name;
    }
  } catch {
    // Best-effort — don't fail notification if name retrieval fails
  }

  await commitWorkflowTransitionLocked({
    workspaceDir,
    project,
    issueId,
    provider,
    workflow,
    plan: completionPlan.transition,
    owner: "pipeline_completion",
    issue,
    closedAt: rule.actions.includes(ACTION.CLOSE_ISSUE) ? new Date().toISOString() : undefined,
    roles: Object.keys(config.roles),
    afterLabel: async () => {
      for (const action of rule.actions) {
        if (action === ACTION.CLOSE_ISSUE) await provider.closeIssue(issueId);
        if (action === ACTION.REOPEN_ISSUE) await provider.reopenIssue(issueId);
      }
    },
  });
  const runtimeState = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];

  if (!runtimeState) throw new Error(`Completion state for #${issueId} was not persisted.`);

  await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId });

  // Notify only after local commit and projection succeed
  const notifyConfig = getNotificationConfig(pluginConfig);

  notify(
    {
      type: "workerComplete",
      project: projectName,
      issueId,
      issueUrl: issue.web_url,
      role,
      level: opts.level,
      name: workerName,
      result,
      summary,
      nextState,
      prUrl,
      createdTasks,
    },
    {
      workspaceDir,
      config: notifyConfig,
      channelId: notifyTarget?.channelId,
      channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
      threadId: notifyTarget?.threadId,
      runtime,
      accountId: notifyTarget?.accountId,
      agentId: project.agentId,
    },
  ).catch((err) => {
    auditLog(workspaceDir, "pipeline_warning", { step: "notify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => { });
  });

  // Send merge notification when PR was merged during this completion
  if (mergedPr) {
    notify(
      {
        type: "prMerged",
        project: projectName,
        issueId,
        issueUrl: issue.web_url,
        issueTitle: issue.title,
        prUrl,
        prTitle,
        sourceBranch,
        targetBranch,
        mergedBy: "pipeline",
      },
      {
        workspaceDir,
        config: notifyConfig,
        channelId: notifyTarget?.channelId,
        channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
        threadId: notifyTarget?.threadId,
        runtime,
        accountId: notifyTarget?.accountId,
        agentId: project.agentId,
      },
    ).catch((err) => {
      auditLog(workspaceDir, "pipeline_warning", { step: "mergeNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => { });
    });
  }

  const targetState = findStateByLabel(workflow, rule.to);

  if (
    targetState?.type === STATE_TYPE.TERMINAL
    && notifyTarget
    && notifyConfig.pipelineComplete !== false
  ) {
    const eventKey = `pipelineComplete:${runtimeState.workflowState}`;
    const reserved = await reservePipelineNotification(workspaceDir, projectSlug, issueId, eventKey);

    if (reserved) {
      const delivered = await notify(
        {
          type: "pipelineComplete",
          project: projectName,
          issueId,
          issueTitle: issue.title,
          issueUrl: issue.web_url,
          terminalState: rule.to,
          pullRequestUrl: prUrl,
          mergeResult: mergedPr ? "merged" : undefined,
          testResult: role === "tester" ? result : undefined,
          issueClosed: rule.actions.includes(ACTION.CLOSE_ISSUE),
        },
        {
          workspaceDir,
          config: notifyConfig,
          channelId: notifyTarget.channelId,
          channel: notifyTarget.channel,
          threadId: notifyTarget.threadId,
          runtime,
          accountId: notifyTarget.accountId,
          agentId: project.agentId,
          runCommand: rc,
        },
      );

      if (delivered) {
        await confirmPipelineNotification(workspaceDir, projectSlug, issueId, eventKey);
      }
    }
  }

  // Send review routing notification when developer completes
  if (role === "developer" && result === COMPLETION_RESULT.DONE) {
    // Re-fetch issue to get labels after transition
    const updated = await provider.getIssue(issueId);
    const routing = runtimeState.reviewPolicy === "human" || runtimeState.reviewPolicy === "agent"
      ? runtimeState.reviewPolicy
      : null;

    if (routing === "human" || routing === "agent") {
      notify(
        {
          type: "reviewNeeded",
          project: projectName,
          issueId,
          issueUrl: updated.web_url,
          issueTitle: updated.title,
          routing,
          prUrl,
        },
        {
          workspaceDir,
          config: notifyConfig,
          channelId: notifyTarget?.channelId,
          channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
          threadId: notifyTarget?.threadId,
          runtime,
          accountId: notifyTarget?.accountId,
          agentId: project.agentId,
        },
      ).catch((err) => {
        auditLog(workspaceDir, "pipeline_warning", { step: "reviewNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => { });
      });
    }
  }

  if (targetState?.type === STATE_TYPE.TERMINAL) {
    const archived = await archiveManagedIssueLocked({
      workspaceDir,
      projectSlug,
      issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
      snapshot: { title: issue.title, issueUrl: issue.web_url },
      actor: "pipeline_completion",
      correlationId: `terminal:${projectSlug}:${issueId}:${runtimeState.workflowState}`,
    });

    if (!archived.archived && archived.reason !== "notification_pending") {
      throw new Error(`Terminal issue #${issueId} could not be archived: ${archived.reason ?? "unknown"}.`);
    }
  }

  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(result);
  const label = key.replace(":", " ").toUpperCase();
  let announcement = `${emoji} ${label} #${issueId}`;

  if (summary) announcement += ` — ${summary}`;
  announcement += `\n📋 [Issue #${issueId}](${issue.web_url})`;
  if (prUrl) announcement += `\n🔗 [PR](${prUrl})`;
  if (createdTasks && createdTasks.length > 0) {
    announcement += `\n📌 Created tasks:`;
    for (const t of createdTasks) {
      announcement += `\n  - [#${t.id}: ${t.title}](${t.url})`;
    }
  }

  announcement += `\n${nextState}.`;

  return {
    labelTransition: `${rule.from} → ${rule.to}`,
    announcement,
    nextState,
    prUrl,
    issueUrl: issue.web_url,
    issueClosed: rule.actions.includes(ACTION.CLOSE_ISSUE),
    issueReopened: rule.actions.includes(ACTION.REOPEN_ISSUE),
  };
}
