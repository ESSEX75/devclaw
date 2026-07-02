/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import type { StateLabel, IssueProvider } from "../../integrations/providers/provider.js";
import { deactivateWorker, loadProjectBySlug, getRoleWorker } from "../../state/projects/index.js";
import type { RunCommand } from "../../context.js";
import { notify, getNotificationConfig } from "../notifications/notify.js";
import { log as auditLog } from "../../audit.js";
import { loadConfig } from "../../state/config/index.js";
import { writeIssueRuntimeState } from "../../state/issues/index.js";
import {
  DEFAULT_WORKFLOW,
  Action,
  WorkflowEvent,
  getCompletionRule,
  getNextStateDescription,
  getCompletionEmoji,
  resolveNotifyChannel,
  type CompletionRule,
  type WorkflowConfig,
} from "../../domain/workflow/index.js";
import type { Channel } from "../../state/projects/index.js";

export type { CompletionRule };

export type CompletionOutput = {
  labelTransition: string;
  announcement: string;
  nextState: string;
  prUrl?: string;
  issueUrl?: string;
  issueClosed?: boolean;
  issueReopened?: boolean;
};

/**
 * Get completion rule for a role:result pair.
 * Uses workflow config when available.
 */
export function getRule(
  role: string,
  result: string,
  workflow: WorkflowConfig = DEFAULT_WORKFLOW,
): CompletionRule | undefined {
  return getCompletionRule(workflow, role, result) ?? undefined;
}

/**
 * Execute the completion side-effects for a role:result pair.
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
  channels: Channel[];
  pluginConfig?: Record<string, unknown>;
  /** Plugin runtime for direct API access (avoids CLI subprocess timeouts) */
  runtime?: PluginRuntime;
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
  const rc = opts.runCommand;
  const {
    workspaceDir, projectSlug, role, result, issueId, summary, provider,
    repoPath, projectName, channels, pluginConfig, runtime,
    workflow = DEFAULT_WORKFLOW,
    createdTasks,
  } = opts;

  const key = `${role}:${result}`;
  const rule = getCompletionRule(workflow, role, result);
  if (!rule) throw new Error(`No completion rule for ${key}`);

  const { timeouts } = await loadConfig(workspaceDir, projectName);
  let prUrl = opts.prUrl;
  let mergedPr = false;
  let prTitle: string | undefined;
  let sourceBranch: string | undefined;
  let mergeFailure: { error: string } | null = null;

  // Execute pre-notification actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.GIT_PULL:
        try { await rc(["git", "pull"], { timeoutMs: timeouts.gitPullMs, cwd: repoPath }); } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "gitPull", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        }
        break;
      case Action.DETECT_PR:
        if (!prUrl) { try {
          // Try open PR first (developer just finished — MR is still open), fall back to merged
          const prStatus = await provider.getPrStatus(issueId);
          prUrl = prStatus.url ?? await provider.getMergedMRUrl(issueId) ?? undefined;
          prTitle = prStatus.title;
          sourceBranch = prStatus.sourceBranch;
        } catch (err) {
          auditLog(workspaceDir, "pipeline_warning", { step: "detectPr", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
        } }
        break;
      case Action.MERGE_PR:
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
  const notifyTarget = resolveNotifyChannel(issue.labels, channels);

  if (mergeFailure) {
    const failedTransition = getMergeFailedTransition(workflow, rule.from);
    if (!failedTransition) {
      throw new Error(`mergePr failed for #${issueId}, and workflow has no MERGE_FAILED recovery transition: ${mergeFailure.error}`);
    }

    await provider.transitionLabel(issueId, rule.from as StateLabel, failedTransition.label as StateLabel);

    await writeIssueRuntimeState({
      workspaceDir,
      project: { slug: projectSlug, channels },
      issue: {
        ...issue,
        labels: issue.labels.filter((label) => label !== rule.from).concat(failedTransition.label),
      },
      providerType: provider.constructor.name.toLowerCase().includes("github") ? "github" : "gitlab",
      workflow,
      workflowState: failedTransition.key,
      workflowLabel: failedTransition.label,
      activeWorker: null,
    });

    await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId: String(issueId) });

    await auditLog(workspaceDir, "pipeline_transition", {
      project: projectName,
      issue: issueId,
      role,
      from: rule.from,
      to: failedTransition.label,
      reason: "merge_failed",
      error: mergeFailure.error,
    });

    return {
      labelTransition: `${rule.from} → ${failedTransition.label}`,
      announcement: `⚠️ MERGE FAILED #${issueId} — ${mergeFailure.error}\n📋 [Issue #${issueId}](${issue.web_url})\n→ ${failedTransition.label}.`,
      nextState: failedTransition.label,
      prUrl,
      issueUrl: issue.web_url,
      issueClosed: false,
      issueReopened: false,
    };
  }

  // Get next state description from workflow
  const nextState = getNextStateDescription(workflow, role, result);

  // Retrieve worker name from project state (best-effort)
  let workerName: string | undefined;
  try {
    const project = await loadProjectBySlug(workspaceDir, projectSlug);
    if (project && opts.level !== undefined && opts.slotIndex !== undefined) {
      const roleWorker = getRoleWorker(project, role);
      const slot = roleWorker.levels[opts.level]?.[opts.slotIndex];
      workerName = slot?.name;
    }
  } catch {
    // Best-effort — don't fail notification if name retrieval fails
  }

  // Send notification early (before deactivation and label transition which can fail)
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
      result: result as "done" | "pass" | "fail" | "refine" | "blocked",
      summary,
      nextState,
      prUrl,
      createdTasks,
    },
    {
      workspaceDir,
      config: notifyConfig,
      channelId: notifyTarget?.channelId,
      channel: notifyTarget?.channel ?? "telegram",
      threadId: notifyTarget?.threadId,
      runtime,
      accountId: notifyTarget?.accountId,
    },
  ).catch((err) => {
    auditLog(workspaceDir, "pipeline_warning", { step: "notify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
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
        mergedBy: "pipeline",
      },
      { workspaceDir, config: notifyConfig, channelId: notifyTarget?.channelId, channel: notifyTarget?.channel ?? "telegram", threadId: notifyTarget?.threadId, runtime, accountId: notifyTarget?.accountId },
    ).catch((err) => {
      auditLog(workspaceDir, "pipeline_warning", { step: "mergeNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
    });
  }

  // Transition label first (critical — if this fails, issue still has correct state)
  // Then execute post-transition actions (close/reopen)
  // Finally deactivate worker (last — ensures label is set even if deactivation fails)
  
  await provider.transitionLabel(issueId, rule.from as StateLabel, rule.to as StateLabel);

  // Execute post-transition actions
  for (const action of rule.actions) {
    switch (action) {
      case Action.CLOSE_ISSUE:
        await provider.closeIssue(issueId);
        break;
      case Action.REOPEN_ISSUE:
        await provider.reopenIssue(issueId);
        break;
    }
  }

  const runtimeState = await writeIssueRuntimeState({
    workspaceDir,
    project: { slug: projectSlug, channels },
    issue: {
      ...issue,
      labels: issue.labels.filter((label) => label !== rule.from).concat(rule.to),
    },
    providerType: provider.constructor.name.toLowerCase().includes("github") ? "github" : "gitlab",
    workflow,
    workflowLabel: rule.to,
    activeWorker: null,
    closedAt: rule.actions.includes(Action.CLOSE_ISSUE) ? new Date().toISOString() : undefined,
  });

  // Deactivate worker last (non-critical — session cleanup)
  await deactivateWorker(workspaceDir, projectSlug, role, { level: opts.level, slotIndex: opts.slotIndex, issueId: String(issueId) });

  // Send review routing notification when developer completes
  if (role === "developer" && result === "done") {
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
          channel: notifyTarget?.channel ?? "telegram",
          threadId: notifyTarget?.threadId,
          runtime,
          accountId: notifyTarget?.accountId,
        },
      ).catch((err) => {
        auditLog(workspaceDir, "pipeline_warning", { step: "reviewNotify", issue: issueId, role, error: (err as Error).message ?? String(err) }).catch(() => {});
      });
    }
  }

  // Build announcement using workflow-derived emoji
  const emoji = getCompletionEmoji(role, result);
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
    issueClosed: rule.actions.includes(Action.CLOSE_ISSUE),
    issueReopened: rule.actions.includes(Action.REOPEN_ISSUE),
  };
}

function getMergeFailedTransition(
  workflow: WorkflowConfig,
  fromLabel: string,
): { key: string; label: string } | null {
  const fromEntry = Object.entries(workflow.states).find(([, state]) => state.label === fromLabel);
  const mergeFailed = fromEntry?.[1].on?.[WorkflowEvent.MERGE_FAILED];
  if (mergeFailed) {
    const key = typeof mergeFailed === "string" ? mergeFailed : mergeFailed.target;
    const state = workflow.states[key];
    return state ? { key, label: state.label } : null;
  }

  const toImprove = Object.entries(workflow.states).find(([, state]) => state.label === "To Improve");
  return toImprove ? { key: toImprove[0], label: toImprove[1].label } : null;
}
