/**
 * Pipeline service — declarative completion rules.
 *
 * Uses workflow config to determine transitions and side effects.
 */

import { log as auditLog } from "../../audit.js";
import { ACTION, DEFAULT_WORKFLOW, findStateByLabel, ISSUE_ARCHIVE_REASON, STATE_TYPE } from "../../domain/index.js";
import { getProject, getRoleWorker, loadConfig, readIssueStateStore, readProjects, readWorkerDeliveryResolution, withIssueOrchestrationLock } from "../../state/index.js";
import { writeIssueRuntimeState } from "../issue-runtime/index.js";
import { archiveManagedIssueLocked } from "../issues/index.js";
import { reconcileManagedLabelsLocked } from "../projection/index.js";
import { renderCompletionAnnouncement } from "./announcement.js";
import { notifyCompletion } from "./completion-notifications.js";
import { PIPELINE_AUDIT, PIPELINE_OWNER } from "./const.js";
import { planCompletion, planMergeFailure } from "./plan.js";
import { applyCompletionLifecycle, executeCompletionActions } from "./provider-actions.js";
import { releaseTransitionWorkerLocked } from "./recovery.js";
import { commitWorkflowTransitionLocked } from "./transition.js";
import type { CompletionInput, CompletionOutput } from "./types.js";

/**
 * Execute the completion side-effects for a role:result pair.
 * @param opts - Resolved worker completion request and runtime dependencies.
 */
export async function executeCompletion(opts: CompletionInput): Promise<CompletionOutput> {
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
async function executeCompletionLocked(opts: CompletionInput): Promise<CompletionOutput> {
  const {
    workspaceDir, projectSlug, role, result, issueId, provider,
    projectName,
    workflow = DEFAULT_WORKFLOW,
  } = opts;

  const key = `${role}:${result}`;
  const config = await loadConfig(workspaceDir, projectSlug);
  const completion = config.roles[role]?.completion;

  if (!completion) throw new Error(`No completion event configured for ${key}`);
  const completionPlan = planCompletion(workflow, role, result, completion);
  const { rule } = completionPlan;

  const project = getProject(await readProjects(workspaceDir), projectSlug);

  if (!project) {
    throw new Error(`Project "${projectSlug}" not found.`);
  }

  let currentState = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];

  if (currentState && currentState.workflowLabel !== rule.from && currentState.workflowLabel !== rule.to) {
    throw new Error(`Completion for #${issueId} expected ${rule.from}, found ${currentState.workflowLabel}.`);
  }

  if (opts.expectedWorker) {
    const expected = opts.expectedWorker;
    const slot = project.workers[expected.role]?.levels[expected.level]?.[expected.slotIndex];

    if (!slot?.active || slot.issueId !== issueId || slot.sessionKey !== expected.sessionKey || (slot.startTime ?? "") !== expected.startedAt) {
      throw new Error(`Worker changed before completion of issue #${issueId}.`);
    }
  }

  const deliveryResolution = await readWorkerDeliveryResolution(workspaceDir, projectSlug, issueId);

  if (deliveryResolution && !deliveryResolution.completed) throw new Error(`Issue #${issueId} has a pending operator delivery resolution.`);

  const currentIssue = await provider.getIssue(issueId);

  if (!currentState && !currentIssue.labels.includes(rule.from)) {
    throw new Error(`Completion for #${issueId} expected provider label ${rule.from}.`);
  }

  if (!currentState) {
    currentState = await writeIssueRuntimeState({ workspaceDir, project, issue: currentIssue,
      providerType: project.provider, workflow, workflowLabel: rule.from });
  }

  const resuming = currentState.workflowLabel === rule.to && rule.from !== rule.to;

  if (resuming && currentState.activeWorker) throw new Error(`Issue #${issueId} has a new active worker.`);
  const actions = resuming
    ? { prUrl: opts.prUrl, mergedPr: false, mergeFailure: null }
    : await executeCompletionActions(opts, rule, config.timeouts.gitPullMs);
  const { prUrl, mergeFailure } = actions;

  const issue = currentIssue;

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
      owner: PIPELINE_OWNER.MERGE_FAILURE,
    });

    await auditLog(workspaceDir, PIPELINE_AUDIT.TRANSITION, {
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

  try {
    if (opts.level !== undefined && opts.slotIndex !== undefined) {
      const roleWorker = getRoleWorker(project, role);
      const slot = roleWorker.levels[opts.level]?.[opts.slotIndex];

      workerName = slot?.name;
    }
  } catch {
    // Best-effort — don't fail notification if name retrieval fails
  }

  if (!resuming) await commitWorkflowTransitionLocked({
    workspaceDir,
    project,
    issueId,
    provider,
    workflow,
    plan: completionPlan.transition,
    owner: PIPELINE_OWNER.COMPLETION,
    issue,
    closedAt: rule.actions.includes(ACTION.CLOSE_ISSUE) ? new Date().toISOString() : rule.actions.includes(ACTION.REOPEN_ISSUE) ? null : undefined,
    roles: Object.keys(config.roles),
    afterLabel: () => applyCompletionLifecycle(opts, rule, issue),
  });
  if (resuming) {
    await releaseTransitionWorkerLocked(workspaceDir, projectSlug, issueId);
    await reconcileManagedLabelsLocked({ workspaceDir, projectSlug, issueId, provider, workflow, roles: Object.keys(config.roles), owner: PIPELINE_OWNER.COMPLETION });
  }

  const runtimeState = (await readIssueStateStore(workspaceDir, projectSlug)).issues[String(issueId)];

  if (!runtimeState) throw new Error(`Completion state for #${issueId} was not persisted.`);

  await notifyCompletion({ opts, project, issue, runtimeState, plan: completionPlan, actions, workerName, notifyAuxiliary: !resuming });
  const targetState = findStateByLabel(workflow, rule.to);

  if (targetState?.type === STATE_TYPE.TERMINAL) {
    const archived = await archiveManagedIssueLocked({
      workspaceDir,
      projectSlug,
      issueId,
      archiveReason: ISSUE_ARCHIVE_REASON.TERMINAL,
      workflow,
      snapshot: { title: issue.title, issueUrl: issue.web_url },
      actor: PIPELINE_OWNER.COMPLETION,
      correlationId: `terminal:${projectSlug}:${issueId}:${runtimeState.workflowState}`,
    });

    if (!archived.archived && archived.reason !== "notification_pending") {
      throw new Error(`Terminal issue #${issueId} could not be archived: ${archived.reason ?? "unknown"}.`);
    }
  }

  const announcement = renderCompletionAnnouncement(opts, issue.web_url, prUrl, nextState);

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
