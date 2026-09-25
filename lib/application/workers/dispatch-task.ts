/**
 * Coordinates atomic worker reservation, provider transition, session dispatch, and runtime persistence.
 * This application capability owns the dispatch use case while state retains worker-slot authority.
 */
import { log as auditLog } from "../../audit.js";
import type { WorkerDeliveryState } from "../../domain/index.js";
import { emptySlot, ISSUE_INTEGRITY_STATUS, NOTIFICATION_CHANNEL, WORKER_DELIVERY_STATUS } from "../../domain/index.js";
import {
  hasReviewCheck,
  isFeedbackState,
} from "../../domain/index.js";
import { ensureSessionFireAndForget, shouldClearSession } from "../../integrations/openclaw/session.js";
import { isIssueCreationReady, loadConfig, loadRoleInstructions } from "../../state/index.js";
import { readIssueStateStore, withIssueOrchestrationLock } from "../../state/index.js";
import { getProject, getRoleWorker, readProjects } from "../../state/index.js";
import { getNotificationConfig, notify } from "../notifications/index.js";
import { resolveIssueNotificationEndpoint } from "../notifications/resolve-endpoint.js";
import { acknowledgeComments, EYES_EMOJI } from "../review/acknowledge-comments.js";
import { fetchPrContext, fetchPrFeedback } from "../review/pr-context.js";
import { formatAttachmentsForTask } from "../tasks/attachments.js";
import { buildAnnouncement, buildConflictFixMessage, buildTaskMessage, formatSessionLabel } from "../tasks/message-builder.js";
import { auditDispatch, dispatchErrorMessage } from "./audit.js";
import { buildDispatchPlan } from "./plan.js";
import { reconcileUncertainDispatch } from "./reconcile-delivery.js";
import { beginWorkerDelivery } from "./session-delivery.js";
import { commitWorkerDispatch, recordIssueDelivery, recordSlotDelivery, releaseDispatchSlot, reserveDispatchSlot } from "./state.js";
import type { DispatchOpts, DispatchResult } from "./types.js";

/**
 * Dispatch a task to a worker session.
 *
 * Flow:
 *   1. Resolve model, session key, and task context.
 *   2. Atomically reserve the selected worker slot.
 *   3. Transition the provider label and send notification.
 *   4. Ensure the session and send the task to the agent.
 *   5. Persist issue runtime state and audit the dispatch.
 *
 * Failures before agent send release the slot and best-effort restore the provider label.
 * State update failures after dispatch are audited because the session is already running.
 *
 * @param opts - Validated project, issue, worker, provider, and runtime dispatch dependencies.
 */
export async function dispatchTask(
  opts: DispatchOpts,
): Promise<DispatchResult> {
  return withIssueOrchestrationLock(
    opts.workspaceDir,
    opts.project.slug,
    opts.issueId,
    () => dispatchTaskLocked(opts),
  );
}

/**
 * Dispatch while the caller already owns this issue's orchestration lock.
 *
 * @param opts - Validated project, issue, worker, provider, and runtime dispatch dependencies.
 */
export async function dispatchTaskLocked(
  opts: DispatchOpts,
): Promise<DispatchResult> {
  const {
    workspaceDir, agentId, project, issueId, issueTitle,
    issueDescription, issueUrl, role, level, fromLabel, toLabel,
    provider, pluginConfig, runtime,
  } = opts;

  const slotIndex = opts.slotIndex ?? 0;
  const rc = opts.runCommand;

  // ── Setup (no side effects — safe to fail) ──────────────────────────
  const existingState = (await readIssueStateStore(workspaceDir, project.slug)).issues[String(issueId)];

  if (existingState?.activeWorker) throw new Error(`Issue #${issueId} already has an active worker.`);
  if (existingState?.integrityStatus === ISSUE_INTEGRITY_STATUS.INTEGRITY_ERROR) {
    throw new Error(`Issue #${issueId} has integrity_error and cannot be dispatched.`);
  }

  if (existingState && !await isIssueCreationReady(workspaceDir, project.slug, existingState.creationOperationId)) {
    throw new Error(`Issue #${issueId} has an unfinished creation operation.`);
  }

  const resolvedConfig = await loadConfig(workspaceDir, project.slug);
  const resolvedRole = resolvedConfig.roles[role];
  const { timeouts } = resolvedConfig;
  const freshProject = getProject(await readProjects(workspaceDir), project.slug);

  if (!freshProject) throw new Error(`Project not found: ${project.slug}`);
  const alreadyReserved = Object.values(freshProject.workers).some((worker) =>
    Object.values(worker.levels).some((slots) => slots?.some((candidate) => candidate.active && candidate.issueId === issueId)));

  if (alreadyReserved) throw new Error(`Issue #${issueId} already has a reserved worker slot.`);
  const roleWorker = getRoleWorker(freshProject, role);
  const slot = roleWorker.levels[level]?.[slotIndex] ?? emptySlot();

  if (slot.active || (slot.issueId !== null && slot.issueId !== issueId)) {
    throw new Error(`Worker slot ${role}:${level}:${slotIndex} is already reserved and requires reconciliation.`);
  }

  const clearExisting = Boolean(slot.sessionKey && timeouts.sessionContextBudget < 1
    && await shouldClearSession(slot.sessionKey, slot.issueId, issueId, timeouts, workspaceDir, project.name, rc));
  const plan = buildDispatchPlan({
    project, agentId, issueId, role, level, slotIndex, slot, resolvedRole, clearExisting,
  });
  const { model, botName, sessionKey, sessionKeyToDelete, sessionAction } = plan;

  // Fetch comments to include in task context
  const comments = await provider.listComments(issueId);

  // Fetch PR context based on workflow role semantics (no hardcoded role/label checks)
  const { workflow } = resolvedConfig;
  const prFeedback = isFeedbackState(workflow, fromLabel)
    ? await fetchPrFeedback(provider, issueId) : undefined;
  const prContext = hasReviewCheck(workflow, role)
    ? await fetchPrContext(provider, issueId) : undefined;

  // Fetch attachment context (best-effort — never blocks dispatch)
  let attachmentContext: string | undefined;

  try {
    attachmentContext = await formatAttachmentsForTask(workspaceDir, project.slug, issueId) || undefined;
  } catch { /* best-effort */ }

  const primaryChannelId = project.channels[0]?.channelId ?? project.slug;
  const isConflictFix = prFeedback?.reason === "merge_conflict";
  const taskMessage = isConflictFix && prFeedback
    ? buildConflictFixMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      resolvedRole, prFeedback,
    })
    : buildTaskMessage({
      projectName: project.name, channelId: primaryChannelId, role, issueId,
      issueTitle, issueDescription, issueUrl,
      repo: project.repo, baseBranch: project.baseBranch,
      comments, resolvedRole, prContext, prFeedback, attachmentContext,
    });

  // Load role-specific instructions to inject into the worker's system prompt
  const roleInstructions = await loadRoleInstructions(workspaceDir, project.slug, role);

  await reserveDispatchSlot(opts, plan);
  let taskDispatched = false;
  let providerTransitioned = false;

  try {
    if (sessionKeyToDelete) {
      await rc(
        ["openclaw", "gateway", "call", "sessions.delete", "--params", JSON.stringify({ key: sessionKeyToDelete })],
        { timeoutMs: 10_000 },
      ).catch(() => { });
    }

    // ── Provider transition — compensated if agent send does not begin ──
    await provider.transitionLabel(issueId, fromLabel, toLabel);
    providerTransitioned = true;

    // Mark issue + PR as managed and all consumed comments as seen (fire-and-forget)
    provider.reactToIssue(issueId, EYES_EMOJI).catch(() => { });
    provider.reactToPr(issueId, EYES_EMOJI).catch(() => { });
    acknowledgeComments(provider, issueId, comments, prFeedback, workspaceDir).catch((err) => {
      auditLog(workspaceDir, "dispatch_warning", {
        step: "acknowledgeComments",
        issue: issueId,
        error: dispatchErrorMessage(err),
      }).catch(() => { });
    });

    const issue = await provider.getIssue(issueId);

    // Ensure session exists (fire-and-forget — don't wait for gateway)
    // Session key is deterministic, so we can proceed immediately
    const sessionLabel = formatSessionLabel(project.name, role, level, botName);

    ensureSessionFireAndForget(sessionKey, model, workspaceDir, rc, timeouts.sessionPatchMs, sessionLabel);

    // Model is set on the session via sessions.patch, not on the agent RPC —
    // the gateway's agent endpoint rejects unknown properties like 'model'.
    const delivery = await beginWorkerDelivery(sessionKey, taskMessage, {
      agentId, projectName: project.name, issueId, role, level, slotIndex, fromLabel,
      orchestratorSessionKey: opts.sessionKey, workspaceDir,
      dispatchTimeoutMs: timeouts.dispatchMs,
      extraSystemPrompt: roleInstructions.trim() || undefined,
      runCommand: rc,
    });

    if (delivery.initial.kind === "rejected") throw new Error(delivery.initial.reason);
    taskDispatched = true;
    const deliveryStatus = delivery.initial.kind === "pending" ? "pending"
      : delivery.initial.kind === "unknown" ? "unknown" : "accepted";
    const unresolved: WorkerDeliveryState | undefined = delivery.initial.kind === "accepted" ? undefined : {
      status: delivery.initial.kind === "pending" ? WORKER_DELIVERY_STATUS.PENDING : WORKER_DELIVERY_STATUS.UNKNOWN,
      recordedAt: new Date().toISOString(),
      reason: delivery.initial.kind === "pending"
        ? "Gateway command is still running; turn acceptance is unconfirmed."
        : delivery.initial.reason,
    };

    await recordSlotDelivery(opts, plan, unresolved).catch(() => { });

    // Notify only after the gateway did not explicitly reject delivery.
    const notifyConfig = getNotificationConfig(pluginConfig);
    const notifyTarget = await resolveIssueNotificationEndpoint(workspaceDir, project, issueId).catch(() => undefined);

    notify({
      type: "workerStart", project: project.name, issueId, issueTitle, issueUrl,
      role, level, name: botName, sessionAction,
    }, {
      workspaceDir, config: notifyConfig,
      channelId: notifyTarget?.channelId,
      channel: notifyTarget?.channel ?? NOTIFICATION_CHANNEL.TELEGRAM,
      threadId: notifyTarget?.threadId, runtime,
      accountId: notifyTarget?.accountId,
      agentId: project.agentId, runCommand: rc,
    }).catch((err) => {
      auditLog(workspaceDir, "dispatch_warning", {
        step: "notify", issue: issueId, role, error: dispatchErrorMessage(err),
      }).catch(() => { });
    });

    // Commit active runtime state after delivery is accepted or remains uncertain.
    try {
      await commitWorkerDispatch(opts, plan, resolvedConfig, issue.labels, unresolved);
    } catch (err) {
      // Session is already dispatched — log warning but don't fail
      await auditLog(workspaceDir, "dispatch", {
        project: project.name, issue: issueId, role,
        warning: "State update failed after successful dispatch",
        error: dispatchErrorMessage(err), sessionKey,
      }).catch(() => { });
    }

    if (delivery.initial.kind === "unknown") {
      await reconcileUncertainDispatch({
        workspaceDir, projectSlug: project.slug, role, level, slotIndex, issueId, sessionKey,
        runCommand: rc, reason: delivery.initial.reason, outcomeUnknown: true,
      })
        .catch(() => { });
    }

    if (delivery.initial.kind === "pending") {
      delivery.settled.then((outcome) => {
        if (outcome.kind === "accepted") {
          recordSlotDelivery(opts, plan, undefined)
            .then(() => recordIssueDelivery(workspaceDir, project.slug, issueId, sessionKey, undefined))
            .catch(() => { });
        } else {
          reconcileUncertainDispatch({
            workspaceDir, projectSlug: project.slug, role, level, slotIndex, issueId, sessionKey,
            runCommand: rc, reason: outcome.reason, outcomeUnknown: true,
          })
            .catch(() => { });
        }
      }).catch(() => { });
    }

    // Audit successful reservation and the observed delivery status.
    await auditDispatch(workspaceDir, {
      project: project.name, issueId, issueTitle,
      role, level, model, sessionAction, sessionKey,
      fromLabel, toLabel,
    }).catch(() => { });

    const announcement = buildAnnouncement(level, role, sessionAction, issueId, issueTitle, issueUrl, resolvedRole, botName);

    return { sessionAction, sessionKey, level, model, announcement, deliveryStatus };
  } catch (error) {
    if (!taskDispatched) {
      if (providerTransitioned) {
        try {
          await provider.transitionLabel(issueId, toLabel, fromLabel);
        } catch (rollbackError) {
          await auditLog(workspaceDir, "dispatch_warning", {
            step: "restoreProviderLabel",
            issue: issueId,
            role,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          }).catch(() => { });
        }
      }

      try {
        await releaseDispatchSlot(opts, plan);
      } catch (rollbackError) {
        await auditLog(workspaceDir, "dispatch_warning", {
          step: "releaseWorkerReservation",
          issue: issueId,
          role,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        }).catch(() => { });
      }
    }

    throw error;
  }
}
